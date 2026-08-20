/**
 * CITY CHAOS'S STREETS: an UNBOUNDED road grid, with a city block filling every square between.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT MOSSY'S LATTICE WITH DIFFERENT SPRITES
 * ---------------------------------------------------------------------------------------------
 * Mossy deals AT MOST ONE free-standing shape per block, inset from its neighbours so nothing can
 * ever join up. A city is the opposite promise: the terrain IS the joins. Roads run forever in
 * both directions, every block face sits exactly against its street, and two adjacent blocks are
 * SUPPOSED to read as one continuous built-up mass with a road between them. So none of the
 * one-shape machinery survives here - and none of Mossy's code is imported, for the same reason
 * cyclesMossy copies rather than references the Scrapyard's curve: a retune of one map's terrain
 * must not be able to reach the other's. The two files share a philosophy and zero symbols.
 *
 * ---------------------------------------------------------------------------------------------
 * THE GEOMETRY: A PERIODIC GRID, ANSWERED BY ARITHMETIC
 * ---------------------------------------------------------------------------------------------
 * The plane is cut into CITY_CELL squares. Every PERIOD cells, on each axis, ROAD_CELLS of them
 * are road; the (PERIOD - ROAD_CELLS)-square left over is a CITY BLOCK. What is standing in a
 * block is a pure function of (seed, block coordinates), so "what is in cell (x, y)" needs no
 * generation pass, no stored chunk and no cache at all: it is a block hash plus a membership
 * test, roughly a dozen integer ops. Mossy needs a memo because it fills an array per block;
 * this file never builds an array in the first place.
 *
 * The grid is PHASED so that the origin is the middle of a crossroads: the player opens every run
 * standing at an intersection with four streets running away from them, which is both a
 * guaranteed-clear spawn (roads are never built on) and the map's whole idea in one screen.
 *
 * ---------------------------------------------------------------------------------------------
 * WHAT A BLOCK CAN BE
 * ---------------------------------------------------------------------------------------------
 *      FILLED         A solid mass of building, inset one cell of pavement from its streets.
 *                     Three silhouettes - the full slab, an L, twin slabs with an alley - so a
 *                     skyline is not a row of identical squares. Permanent: nothing breaks it.
 *      CONSTRUCTION   The same footprint as a building that IS NOT THERE YET: a breakable site
 *                     fence around an open interior, with one or two gateway gaps, and a few
 *                     material piles scattered inside. The fences and piles come down like
 *                     Mossy's trees and leave rubble.
 *      COURTYARD      A building drawn as a ring around an open centre, one gateway cut through
 *                     it. A room to fight in, with walls that mean it - the ring is permanent,
 *                     so the gateway is the only way in and out.
 *      PLAZA          Open ground. What stops the city reading as a maze.
 *
 * ---------------------------------------------------------------------------------------------
 * DETERMINISM
 * ---------------------------------------------------------------------------------------------
 * Everything comes from integer mixing on `Math.imul` and `^` over (seed, block, cell). No
 * `Math.pow`, no trigonometry, no wall clock, no Map iteration order - a replay recorded on a
 * phone reproduces in Node, which is the rule all of `src/core/` is built on. The two mutable
 * pieces of state - broken fence cells and their remaining hit points - live in Sets/Maps keyed
 * by global cell, exactly as Mossy keeps its felled trees.
 */

import type { SceneryPush } from './scenery.js';

/**
 * Edge of one lattice cell, world units. Same figure Mossy landed on and for the same measured
 * reason: the mech is 52 units wide, so 64 is the smallest cell a one-cell gap can be driven
 * through under pressure. Roads here are two cells anyway; this number matters for the gateways
 * cut into courtyard rings and site fences, which are exactly two cells so they never feel like
 * threading a needle.
 */
export const CITY_CELL = 64;

/**
 * Cells from one road's left edge to the next road's left edge - the period of the whole city.
 *
 * 10 cells = 640 u. Two of them are road, eight are block. An 8-cell block is 512 u square,
 * sized against the camera's 616 x 440 view (measured off the real renderer, see wallsMossy's
 * own sizing note): ONE BLOCK FITS WITH ROOM ON EVERY SIDE, which is the brief in as many words.
 * A first pass at 12/10 measured a block that read as oversized by roughly a cell on every edge -
 * it never fully cleared the view on any orientation, so the "one shape in front of you" promise
 * Mossy's own sizing note describes never actually landed. Bigger and a filled block becomes a
 * featureless wall for seconds at a time; smaller and the city turns into a lattice of alleys
 * with no room for the horde to flank in.
 */
export const CITY_PERIOD = 10;

/**
 * Cells of road between blocks. 2 cells = 128 u of open street: two mechs wide with room, enough
 * to fight down without being enough to forget the buildings are there. One cell was rejected
 * without testing - a 64 u street reads as a doorway, not a road.
 */
export const CITY_ROAD_CELLS = 2;

/** Cells along one edge of a block interior. Derived, but named: everything below uses it. */
export const CITY_BLOCK_CELLS = CITY_PERIOD - CITY_ROAD_CELLS;

/**
 * THE PHASE: how many cells the whole grid is shifted so the origin lands mid-crossroads.
 *
 * With roads on local cells 0..1 of each period, shifting by +1 puts cells -1 and 0 on the road
 * on both axes - so (0, 0), the exact point every run opens on, is the centre seam of an
 * intersection, with the four streets running away along the axes.
 */
const CITY_PHASE = 1;

/** What a cell holds. */
export const CITY_EMPTY = 0;
/** Building mass. Permanent - nothing in the game breaks a building. */
export const CITY_BUILDING = 1;
/** Construction-site fencing or a material pile. Breakable; leaves rubble. */
export const CITY_FENCE = 2;

/**
 * HIT POINTS OF ONE FENCE CELL, split into two visible sections the way a Mossy cell splits into
 * stems: the first section falls at half damage, the cell opens at zero.
 *
 * 180 total against Mossy's 440-660 per tree cell, and that gap is the design: a site fence is
 * plywood and scaffold, not a wood. It is something a mid-run loadout removes in about a second
 * of attention - a shortcut you can BUY, cheap enough to be worth it, not so cheap that the
 * fences might as well not exist.
 */
export const FENCE_SECTION_HP = 90;
export const FENCE_SECTIONS = 2;

/**
 * Block type shares, as a CDF over the block hash.
 *
 * Filled blocks dominate - a city is mostly buildings or it is not a city - but only just: every
 * second-ish block is one of the open kinds, because the horde needs somewhere to surround the
 * player and the player needs somewhere to kite. Construction sites outnumber courtyards since
 * their fences are the map's one destructible and the toy deserves screen time.
 */
const BLOCK_FILLED = 0;
const BLOCK_CONSTRUCTION = 1;
const BLOCK_COURTYARD = 2;
const BLOCK_PLAZA = 3;
const BLOCK_CDF: readonly number[] = Object.freeze([
  0.34, // filled        34%
  0.64, // construction  30%
  0.84, // courtyard     20%
  1.0, //  plaza         16%
]);

/**
 * Packing bias for global cell keys, same scheme as Mossy's: a run can reach a few thousand cells
 * from the origin, 2^20 is four orders of magnitude past that, and the packed key stays exactly
 * representable in a double.
 */
const KEY_BIAS = 1 << 20;
const KEY_SPAN = 1 << 21;

export interface CityBlocks {
  readonly kind: 'city';
  /** The run seed. The whole city is a pure function of this. */
  readonly seed: number;
  /** Global cells whose fence has been broken. Never evicted - a hole stays a hole. */
  readonly broken: Set<number>;
  /**
   * Damage taken by fence cells that are hurt and not yet down, keyed by global cell. Absent
   * means untouched; an entry is deleted when its cell breaks. Only ever holds the handful the
   * player is actively shooting at.
   */
  readonly hurt: Map<number, number>;
  /** Fences broken this run. Diagnostics and the harness; nothing branches on it. */
  count: number;
  /** Bumped when what is standing changes. Read by anything caching routes off the terrain. */
  version: number;
}

export function createCityBlocks(seed: number): CityBlocks {
  return {
    kind: 'city',
    seed: seed | 0,
    broken: new Set(),
    hurt: new Map(),
    count: 0,
    version: 0,
  };
}

// -------------------------------------------------------------------------------------------
// The grid arithmetic
// -------------------------------------------------------------------------------------------

/** Floor division, correct for the negative half of the plane. */
function floorDiv(a: number, b: number): number {
  return Math.floor(a / b);
}

/** Non-negative modulo, same caveat. */
function mod(a: number, b: number): number {
  const m = a % b;
  return m < 0 ? m + b : m;
}

/** Cell column containing a world x (also the row for a world y - the lattice is square). */
export function cityCellOf(v: number): number {
  return Math.floor(v / CITY_CELL);
}

/** Centre of a cell, per axis. */
export function cityCentre(c: number): number {
  return (c + 0.5) * CITY_CELL;
}

/**
 * Local position of a cell within its period: 0..ROAD_CELLS-1 is road, anything above is the
 * block interior (0-based after subtracting ROAD_CELLS).
 */
function localOf(c: number): number {
  return mod(c + CITY_PHASE, CITY_PERIOD);
}

/** True when this cell is street on this axis. A cell is ROAD if either axis says so. */
export function cityIsRoadCell(c: number): boolean {
  return localOf(c) < CITY_ROAD_CELLS;
}

/**
 * True when the cell is road - open, and drawn as asphalt by the dressing. Pure arithmetic;
 * exported for the renderer, which paints streets without ever asking about buildings.
 */
export function cityIsRoad(cx: number, cy: number): boolean {
  return cityIsRoadCell(cx) || cityIsRoadCell(cy);
}

/** Which block a non-road cell belongs to, per axis. */
function blockIndexOf(c: number): number {
  return floorDiv(c + CITY_PHASE, CITY_PERIOD);
}

// -------------------------------------------------------------------------------------------
// Hashing
// -------------------------------------------------------------------------------------------

/** A 32-bit hash of one block and the seed. Three mixing rounds, same construction Mossy uses. */
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
 * A stable 0..1 for question `q` about one block, re-mixed from its hash. The raw bits of one
 * hash are too correlated to slice directly - Mossy's dressing learned that as trunks lining up
 * on a diagonal; here it would be every block's gateway on the same side.
 */
function blockFrac(h: number, q: number): number {
  let v = Math.imul(h ^ Math.imul(q + 1, 0x9e3779b1), 0xc2b2ae35);
  v ^= v >>> 16;
  v = Math.imul(v, 0x27d4eb2f);
  return ((v ^ (v >>> 15)) >>> 0) / 4294967296;
}

/** A stable integer in [0, n) for question `q`. */
function blockInt(h: number, q: number, n: number): number {
  const v = Math.floor(blockFrac(h, q) * n);
  return v >= n ? n - 1 : v;
}

function cellKey(cx: number, cy: number): number {
  return (cx + KEY_BIAS) * KEY_SPAN + (cy + KEY_BIAS);
}

// -------------------------------------------------------------------------------------------
// What is standing in a block
// -------------------------------------------------------------------------------------------

/**
 * Question indices for `blockFrac`/`blockInt`. Named so no two rolls can collide by accident and
 * so a new roll is a new name rather than a magic number.
 */
const Q_TYPE = 0;
const Q_SHAPE = 1;
const Q_GATE_SIDE = 2;
const Q_GATE_ALONG = 3;
const Q_GATE2 = 4;
const Q_GATE2_SIDE = 5;
const Q_GATE2_ALONG = 6;
const Q_SCATTER = 7; // ..and the six after it, one per possible pile.

/** Material piles a construction site scatters inside its fence. */
const SCATTER_MIN = 3;
const SCATTER_SPAN = 3;

/**
 * WHAT THE BLOCK PUTS IN LOCAL CELL (lx, ly), 0..CITY_BLOCK_CELLS-1 on both axes, before the
 * broken set is consulted. Pure in (hash of block, lx, ly).
 *
 * The layouts below all speak in the same terms: the interior is an 8x8 field of cells, ring 0
 * is its outermost cells (the pavement - always open, so nothing built ever touches the street),
 * and structures live from ring 1 inward.
 */
/** Which of the four layouts a block deals, from its hash: the Q_TYPE roll against the CDF. */
function blockTypeOf(h: number): number {
  const roll = blockFrac(h, Q_TYPE);
  for (let i = 0; i < BLOCK_CDF.length; i++) {
    if (roll < BLOCK_CDF[i]) return i;
  }
  return BLOCK_PLAZA;
}

function blockCellKind(h: number, lx: number, ly: number): number {
  const n = CITY_BLOCK_CELLS;
  // Ring 0 is pavement on every block type. Structures start one cell in, which is what keeps a
  // building face from sitting flush against the asphalt and reading as a wall of the street.
  const ring = Math.min(lx, ly, n - 1 - lx, n - 1 - ly);
  if (ring === 0) return CITY_EMPTY;

  const type = blockTypeOf(h);

  if (type === BLOCK_PLAZA) return CITY_EMPTY;

  if (type === BLOCK_FILLED) {
    // The mass spans rings 1+ (a 6x6 slab). Three silhouettes, dealt by one roll.
    const shape = blockInt(h, Q_SHAPE, 3);
    if (shape === 1) {
      // The L: the full slab minus one quadrant. Which corner is bitten out is the same roll's
      // upper bits, via a different question to keep it independent of the shape choice itself.
      const corner = blockInt(h, Q_GATE2, 4);
      const half = Math.floor(n / 2);
      const inBiteX = corner % 2 === 0 ? lx < half : lx >= half;
      const inBiteY = corner < 2 ? ly < half : ly >= half;
      if (inBiteX && inBiteY) return CITY_EMPTY;
    } else if (shape === 2) {
      // Twin slabs: rows 1..3 and 6..8 built, the two middle rows an alley. Horizontal or
      // vertical, by one more question.
      const vertical = blockFrac(h, Q_GATE2_SIDE) < 0.5;
      const along = vertical ? lx : ly;
      const mid = Math.floor(n / 2);
      if (along === mid - 1 || along === mid) return CITY_EMPTY;
    }
    return CITY_BUILDING;
  }

  // Both remaining types are a RING WITH GATEWAYS, one cell thick, cut by a gap that goes all the
  // way through. Shared gateway logic, so a gap is always GATE_WIDTH cells wide and always square
  // through the ring - see `inGateway` for why the gap's POSITION has to know the thickness.
  const thick = RING_THICKNESS;
  const onRing = ring >= 1 && ring <= thick;

  if (onRing) {
    if (inGateway(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly)) return CITY_EMPTY;
    // Construction sites sometimes get a second way in; courtyards never do - one door is what
    // makes a courtyard a commitment.
    if (
      type === BLOCK_CONSTRUCTION &&
      blockFrac(h, Q_GATE2) < 0.5 &&
      inGateway(h, Q_GATE2_SIDE, Q_GATE2_ALONG, thick, lx, ly)
    ) {
      return CITY_EMPTY;
    }
    return type === BLOCK_COURTYARD ? CITY_BUILDING : CITY_FENCE;
  }

  // Inside a construction site: a few material piles, at hashed cells strictly inside the fence.
  //
  // EXCEPT IN A GATEWAY'S AISLE. A pile is the same breakable kind as the fence, so one dealt into
  // the cell just behind the gap turned the gap into a wall you had to shoot anyway - the site
  // still had "one or two entrances" in the generator and none on screen. Keeping the gate's own
  // two lanes clear, at every depth, means a doorway is always a doorway: you can drive in, and
  // what you break once inside is a choice rather than the price of entry.
  if (type === BLOCK_CONSTRUCTION && ring > thick) {
    const secondGate = blockFrac(h, Q_GATE2) < 0.5;
    const inAisle =
      inGatewayLane(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly) ||
      (secondGate && inGatewayLane(h, Q_GATE2_SIDE, Q_GATE2_ALONG, thick, lx, ly));
    if (!inAisle) {
      const piles = SCATTER_MIN + blockInt(h, Q_SCATTER, SCATTER_SPAN);
      const lo = thick + 1;
      const span = n - 2 * lo;
      for (let k = 0; k < piles; k++) {
        const px = lo + blockInt(h, Q_SCATTER + 1 + k * 2, span);
        const py = lo + blockInt(h, Q_SCATTER + 2 + k * 2, span);
        if (px === lx && py === ly) return CITY_FENCE;
      }
    }
  }
  return CITY_EMPTY;
}

/** Width of every gateway, cells. Two: the same clearance as a street is narrow enough. */
const GATE_WIDTH = 2;

/**
 * HOW MANY CELLS THICK A RING BLOCK'S WALL IS - the same for both ring types.
 *
 * Courtyards used to build two, and that is the change. At the 10-cell period this map settled
 * on, a block interior is 8 cells and its outermost ring is pavement, so a two-cell wall left a
 * 2x2 courtyard: a 128 u room behind a wall as thick as the room is wide. One cell turns that
 * into a 4x4, 256 u room with a 64 u wall round it, which is the "room to fight in" the block was
 * always for. It also gives the gateway somewhere to move - see `inGateway` - where a two-cell
 * wall left exactly one legal position and no variety at all.
 *
 * The clamp is a safety net rather than live arithmetic: a ring needs enough lanes to seat a
 * GATE_WIDTH gap clear of the wall on both sides, so if a future period shrinks the block past
 * that, the wall thins instead of sealing the middle. `inGateway` derives its range from this
 * same number, so the two cannot disagree about what a gateway has to cut through.
 */
const RING_THICKNESS = Math.min(1, Math.floor((CITY_BLOCK_CELLS - GATE_WIDTH - 1) / 2));

/** The same number, for the renderer - see `cityFenceRing` for what it wants it for. */
export const CITY_RING_THICKNESS = RING_THICKNESS;

/**
 * True when (cx, cy) sits on a block's WALL RING - the cells a construction fence or courtyard
 * wall can occupy. False on roads, on the pavement apron, and anywhere deeper inside the block.
 *
 * Exported for the dressing, which draws two different things out of one cell kind: a CITY_FENCE
 * cell ON the ring is a run of site barrier and joins up with its neighbours, while a CITY_FENCE
 * cell deeper in is a free-standing material pile. Distance from the block edge is the fact that
 * separates them, and it lives here because the ring geometry lives here - a renderer-side copy
 * of `localOf` would be the phase constant existing twice.
 */
export function cityFenceRing(cx: number, cy: number): boolean {
  if (cityIsRoad(cx, cy)) return false;
  const lx = localOf(cx) - CITY_ROAD_CELLS;
  const ly = localOf(cy) - CITY_ROAD_CELLS;
  const n = CITY_BLOCK_CELLS;
  const ring = Math.min(lx, ly, n - 1 - lx, n - 1 - ly);
  return ring >= 1 && ring <= RING_THICKNESS;
}

/**
 * True when (cx, cy) lies in a block that dealt CONSTRUCTION - roads excluded. Exported for the
 * dressing, which scatters site litter over exactly these blocks: mess belongs inside the hoarding
 * and on the pavement in front of it, not on a plaza three streets away. Pure arithmetic on the
 * block hash, so the renderer can ask it per visible cell without the simulation keeping anything.
 */
export function cityIsConstructionBlock(c: CityBlocks, cx: number, cy: number): boolean {
  if (cityIsRoad(cx, cy)) return false;
  return blockTypeOf(hashBlock(c.seed, blockIndexOf(cx), blockIndexOf(cy))) === BLOCK_CONSTRUCTION;
}

/**
 * Is local cell (lx, ly) inside the gateway named by questions (qSide, qAlong)? A gateway is a
 * GATE_WIDTH-wide band cut perpendicular through one side of the ring, its position drawn from
 * the block hash.
 *
 * THE BAND'S RANGE HAS TO KNOW HOW THICK THE RING IS, and that is the bug this argument exists to
 * fix. The range used to be a flat 1..n-1-GATE_WIDTH - "anywhere but hard against a corner" -
 * which is the right answer only for a one-cell wall. Cut that band near a corner of a THICKER
 * ring and it opens a notch into the wall's own corner and stops: the cells behind it are still
 * wall, so the middle stays sealed. A courtyard came out as a room with no door, visible from the
 * street and impossible to enter, on about a quarter of the courtyards generated.
 *
 * So the band is constrained to the lanes that are actually INTERIOR - `thick + 1` through
 * `n - 2 - thick` - which is exactly the set of lanes where a straight cut from outside reaches
 * open ground. That also keeps the gap off the corners for free, which is what the old range was
 * reaching for.
 */
function inGateway(
  h: number,
  qSide: number,
  qAlong: number,
  thick: number,
  lx: number,
  ly: number,
): boolean {
  const n = CITY_BLOCK_CELLS;
  const side = blockInt(h, qSide, 4);
  // Depth is the ring's own thickness: the cut goes through the wall and no further.
  const throughWall =
    side === 0 ? ly <= thick : side === 1 ? ly >= n - 1 - thick : side === 2 ? lx <= thick : lx >= n - 1 - thick;
  return throughWall && inGatewayLane(h, qSide, qAlong, thick, lx, ly);
}

/**
 * The gateway's LANE, at any depth into the block - the two-cell aisle running straight in from
 * the gap. `inGateway` is this intersected with the wall's thickness; the pile scatter uses the
 * lane on its own, to keep the way in clear. Sharing the band arithmetic between the two is the
 * point: a pile that avoided a differently-computed lane would be avoiding the wrong cells.
 */
function inGatewayLane(
  h: number,
  qSide: number,
  qAlong: number,
  thick: number,
  lx: number,
  ly: number,
): boolean {
  const n = CITY_BLOCK_CELLS;
  const side = blockInt(h, qSide, 4);
  const lo = thick + 1;
  // The last start position whose whole band still lands on interior lanes.
  const span = n - 1 - thick - GATE_WIDTH - lo + 1;
  const along = lo + blockInt(h, qAlong, Math.max(1, span));
  const across = side === 0 || side === 1 ? lx : ly;
  return across >= along && across < along + GATE_WIDTH;
}

/**
 * WHAT IS IN CELL (cx, cy): one of the CITY_* values. The broken set is applied here, so every
 * query in the file - collision, rays, the dressing - sees one world.
 */
export function cityKindAt(c: CityBlocks, cx: number, cy: number): number {
  if (cityIsRoad(cx, cy)) return CITY_EMPTY;
  const bx = blockIndexOf(cx);
  const by = blockIndexOf(cy);
  const lx = localOf(cx) - CITY_ROAD_CELLS;
  const ly = localOf(cy) - CITY_ROAD_CELLS;
  const kind = blockCellKind(hashBlock(c.seed, bx, by), lx, ly);
  if (kind === CITY_FENCE && c.broken.has(cellKey(cx, cy))) return CITY_EMPTY;
  return kind;
}

/** True if this cell held fencing that has since been broken. The dressing draws rubble there. */
export function isCityBroken(c: CityBlocks, cx: number, cy: number): boolean {
  return c.broken.has(cellKey(cx, cy));
}

// -------------------------------------------------------------------------------------------
// The queries `scenery.ts` dispatches to
// -------------------------------------------------------------------------------------------

/** Cell index packing for the Scenery contract, mirroring Mossy's. */
export function packCityCell(cx: number, cy: number): number {
  return cellKey(cx, cy);
}
export function cityCellX(i: number): number {
  return Math.floor(i / KEY_SPAN) - KEY_BIAS;
}
export function cityCellY(i: number): number {
  return (i % KEY_SPAN) - KEY_BIAS;
}

/** Half a cell: the radius a cell reports, and what sizes the burst when a fence goes up. */
export const CITY_HALF = CITY_CELL / 2;

/** Squared distance from (x, y) to the nearest point of cell (cx, cy); 0 when inside it. */
function cellDist2(cx: number, cy: number, x: number, y: number): number {
  const x0 = cx * CITY_CELL;
  const y0 = cy * CITY_CELL;
  const dx = x < x0 ? x0 - x : x > x0 + CITY_CELL ? x - (x0 + CITY_CELL) : 0;
  const dy = y < y0 ? y0 - y : y > y0 + CITY_CELL ? y - (y0 + CITY_CELL) : 0;
  return dx * dx + dy * dy;
}

/**
 * The first standing cell the circle (x, y, r) touches, or -1. Fences count - a shell stops on a
 * site fence and then breaks it, exactly as one does on a Mossy tree.
 *
 * `d2 === 0` IS A HIT, for the reason wallsMossy documents at length: a projectile is tested as a
 * point, a point inside a box is at distance zero, and the strict inequality alone would let
 * every round in the game fly through every wall.
 */
export function cityOverlap(c: CityBlocks, x: number, y: number, r: number): number {
  const c0 = cityCellOf(x - r);
  const c1 = cityCellOf(x + r);
  const r0 = cityCellOf(y - r);
  const r1 = cityCellOf(y + r);
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (cityKindAt(c, cx, cy) === CITY_EMPTY) continue;
      const d2 = cellDist2(cx, cy, x, y);
      if (d2 === 0 || d2 < r * r) return packCityCell(cx, cy);
    }
  }
  return -1;
}

/** The nearest BREAKABLE cell the circle touches, or -1. */
export function cityDestructibleOverlap(c: CityBlocks, x: number, y: number, r: number): number {
  const c0 = cityCellOf(x - r);
  const c1 = cityCellOf(x + r);
  const r0 = cityCellOf(y - r);
  const r1 = cityCellOf(y + r);
  let best = -1;
  let bestD2 = 0;
  for (let cy = r0; cy <= r1; cy++) {
    for (let cx = c0; cx <= c1; cx++) {
      if (cityKindAt(c, cx, cy) !== CITY_FENCE) continue;
      const d2 = cellDist2(cx, cy, x, y);
      if (d2 !== 0 && d2 >= r * r) continue;
      if (best < 0 || d2 < bestD2) {
        best = packCityCell(cx, cy);
        bestD2 = d2;
      }
    }
  }
  return best;
}

/** See wallsMossy's PUSH_PASSES: measured there, and the geometry here is the same lattice. */
const PUSH_PASSES = 3;

const PUSH: SceneryPush = { x: 0, y: 0, nx: 0, ny: 0, hit: false };

/**
 * Slides a circle out of whatever it has entered. The same corner-exact, open-face-aware routine
 * Mossy's lattice uses - documented there in full - because a box lattice is a box lattice: a
 * body in an inside corner is genuinely inside two cells, and a body buried by a spawn must
 * leave through a face that opens onto air or it walks the inside of the wall forever.
 */
export function pushOutOfCity(
  c: CityBlocks,
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
    const c0 = cityCellOf(px - r);
    const c1 = cityCellOf(px + r);
    const r0 = cityCellOf(py - r);
    const r1 = cityCellOf(py + r);

    let bestCx = 0;
    let bestCy = 0;
    let bestD2 = r * r;
    let found = false;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        if (cityKindAt(c, cx, cy) === CITY_EMPTY) continue;
        const d2 = cellDist2(cx, cy, px, py);
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        bestCx = cx;
        bestCy = cy;
        found = true;
      }
    }
    if (!found) break;

    const x0 = bestCx * CITY_CELL;
    const y0 = bestCy * CITY_CELL;
    const x1 = x0 + CITY_CELL;
    const y1 = y0 + CITY_CELL;

    if (bestD2 > 0) {
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
      const dl = px - x0;
      const dr = x1 - px;
      const du = py - y0;
      const dd = y1 - py;
      const openL = cityKindAt(c, bestCx - 1, bestCy) === CITY_EMPTY;
      const openR = cityKindAt(c, bestCx + 1, bestCy) === CITY_EMPTY;
      const openU = cityKindAt(c, bestCx, bestCy - 1) === CITY_EMPTY;
      const openD = cityKindAt(c, bestCx, bestCy + 1) === CITY_EMPTY;
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
 * DDA over the lattice: distance at which the ray first enters a cell whose kind is `want`, or
 * -1 within `maxT`. Same traversal as Mossy's, same reasons, own copy.
 */
let rayCellX = 0;
let rayCellY = 0;

function rayWalk(
  c: CityBlocks,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
  want: number,
): number {
  let cx = cityCellOf(ox);
  let cy = cityCellOf(oy);

  if (cityKindAt(c, cx, cy) === want) {
    rayCellX = cx;
    rayCellY = cy;
    return 0;
  }

  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const tDeltaX = dx === 0 ? Infinity : CITY_CELL / (dx < 0 ? -dx : dx);
  const tDeltaY = dy === 0 ? Infinity : CITY_CELL / (dy < 0 ? -dy : dy);

  const nextX = (cx + (dx > 0 ? 1 : 0)) * CITY_CELL;
  const nextY = (cy + (dy > 0 ? 1 : 0)) * CITY_CELL;
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
    if (cityKindAt(c, cx, cy) === want) {
      rayCellX = cx;
      rayCellY = cy;
      return t;
    }
  }
}

/**
 * Distance at which the ray first meets BUILDING, or -1. Fences are exempt, exactly as fuel
 * barrels and trees are on the other maps: a beam must be able to burn one down rather than
 * refusing to fire at it.
 */
export function cityRayHit(
  c: CityBlocks,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  return rayWalk(c, ox, oy, dx, dy, maxT, CITY_BUILDING);
}

let rayHitT = -1;

export function cityLastRayT(): number {
  return rayHitT;
}

/** The first FENCE the ray enters, packed, or -1. The complement of `cityRayHit`. */
export function cityDestructibleRayHit(
  c: CityBlocks,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  const t = rayWalk(c, ox, oy, dx, dy, maxT, CITY_FENCE);
  rayHitT = t;
  if (t < 0) return -1;
  return packCityCell(rayCellX, rayCellY);
}

/** Breaks the fence in a packed cell. One write; every query forgets it at once. */
export function breakCityCell(c: CityBlocks, i: number): void {
  if (c.broken.has(i)) return;
  c.broken.add(i);
  c.hurt.delete(i);
  c.count++;
  c.version++;
}

/**
 * How many fence sections of a cell still stand: FENCE_SECTIONS untouched, 0 once broken, the
 * remaining fraction rounded UP in between - a section stands until its share of the pool is
 * gone, so every hit reads as progress and the last hit is the one that opens the gap.
 */
export function citySectionsStanding(c: CityBlocks, cx: number, cy: number): number {
  const i = cellKey(cx, cy);
  if (c.broken.has(i)) return 0;
  const left = c.hurt.get(i);
  if (left === undefined) return FENCE_SECTIONS;
  const up = Math.ceil(left / FENCE_SECTION_HP);
  return up < 0 ? 0 : up > FENCE_SECTIONS ? FENCE_SECTIONS : up;
}

/**
 * Puts damage into a fence cell. Returns how many sections that hit brought down - 0 for most
 * hits - which the caller turns into events. The version bumps only when the cell OPENS, for the
 * flow-field reason wallsMossy documents: a section is drawn, the cell is the collider.
 */
export function damageCityCell(c: CityBlocks, i: number, amount: number): number {
  if (amount <= 0 || c.broken.has(i)) return 0;
  const before = c.hurt.get(i) ?? FENCE_SECTIONS * FENCE_SECTION_HP;
  const after = before - amount;
  const standingBefore = Math.ceil(before / FENCE_SECTION_HP);

  if (after <= 0) {
    breakCityCell(c, i);
    return standingBefore;
  }
  c.hurt.set(i, after);
  const standingAfter = Math.ceil(after / FENCE_SECTION_HP);
  return standingBefore - standingAfter;
}
