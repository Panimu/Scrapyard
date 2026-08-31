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
// TYPE-ONLY, BOTH OF THEM. scenery.ts value-imports this file, so a value import back would be a
// cycle - which is also why `regrowCityBarrel` takes its minimum distance as an argument rather
// than reaching for BARREL_REGROW_MIN_DIST where that constant is declared.
import type { Rng } from '../rng.js';

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
 * A FUEL DRUM - the Scrapyard's, standing in the city's streets. Breakable, and the only thing on
 * this map that pays out when it goes.
 *
 * WHY THE CITY HAS BARRELS AND NOT A FLOCK. This map opened with Mossy's sheep because the moss
 * had solved the same problem: a map whose terrain gives nothing back needs a loot prop, and a
 * building cannot be broken. Sheep in a city was always the weakest joke in the level, and the
 * yard's own drum is the better answer - it is already the game's loot prop, it already has art,
 * and unlike an animal it does not have to be walked about by a whole simulation system.
 *
 * IT IS A CELL, not an entity, which is what makes it free: the city grid is a pure function of
 * the seed, so barrels need no pool, no upkeep tick and no cull radius. They cannot land on a road
 * because roads are answered before any block layout is consulted at all.
 */
export const CITY_BARREL = 3;

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
 * Half-extent of a drum's collider, world units - and it is NOT half a cell.
 *
 * 20, quoted from the Scrapyard's own `BARREL_RADIUS` and for the reason recorded there: at 30 a
 * drum was 60 u across against a 58 u mech and read as a small pile rather than as a barrel. The
 * cell it sits in is 64 u, so the collider is an inset box - every query in this file already
 * measures against a box, and handing them a smaller one is the whole of the change.
 */
export const CITY_BARREL_HALF = 20;

/**
 * Share of a block's OPEN cells that hold a drum.
 *
 * DERIVED FROM THE OTHER TWO MAPS RATHER THAN PICKED. Both of them independently land on about the
 * same density of loot props per unit of ground:
 *
 *     Scrapyard   SCENERY_FILL 0.7315 x 41.36% fuel barrels, per 768 u cell   = 5.1e-7 / u^2
 *     Mossy       4 sheep alive inside the 1500 u cull radius                 = 5.7e-7 / u^2
 *
 * A city cell is 64 u square = 4096 u^2, so matching ~5.4e-7 wants 0.0022 drums per cell of GROUND.
 * Open cells are roughly a third of the plane here (36% of it is road, and much of each block is
 * solid building), which puts the share of OPEN cells at about 0.7%.
 *
 * That is deliberately the measured figure and not a flattering one: it is around one drum per two
 * or three blocks, so a screen shows one about half the time. Both other maps play at that density
 * and neither reads as starved.
 */
const CITY_BARREL_SHARE = 0.007;

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

/**
 * A stable 0..1 for question `q` about ONE CELL of a block, rather than about the block as a whole.
 *
 * `blockFrac` answers "where is this block's gateway"; this answers "is there a drum in this
 * particular cell", which needs the local coordinates in the mix. Same construction and the same
 * reason for it: the raw bits of the block hash are far too correlated between neighbouring cells
 * to slice, and a drum every Nth cell on a diagonal is exactly what that looks like on screen.
 */
function cellFrac(h: number, lx: number, ly: number, q: number): number {
  let v = Math.imul(h ^ Math.imul(lx + 1, 0x2545f491), 0x9e3779b1);
  v = Math.imul(v ^ Math.imul(ly + 1, 0x85ebca6b), 0xc2b2ae35);
  v ^= Math.imul(q + 1, 0x27d4eb2f);
  v ^= v >>> 15;
  v = Math.imul(v, 0x2c1b3c6d);
  return ((v ^ (v >>> 13)) >>> 0) / 4294967296;
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
const Q_SCATTER = 7; // ..and the ten after it, two per possible pile.
/**
 * FIVE PILES CLAIM UP TO QUESTION 17, and this comment used to say 16.
 *
 * The loop draws `Q_SCATTER + 1 + k*2` and `Q_SCATTER + 2 + k*2` for k in 0..4, so the fifth
 * pile's ROW is question 7 + 2 + 8 = 17. The off-by-one here is not a documentation slip: it is
 * how Q_SITE came to be given 17, which made a site's silhouette and that pile's row THE SAME
 * ROLL. Every lane site put its fifth pile on row 5, every hoarding put it on row 2 or 3, and
 * nothing looked wrong enough to notice - which is exactly what the "no two rolls can collide by
 * accident" rule above exists to prevent, and exactly why the rule needs the arithmetic written
 * out rather than summarised.
 */
/** Which silhouette a construction site's hoarding takes, and which way round it faces. */
const Q_SITE = 18;
const Q_SITE_ROT = 19;
/** Well clear of Q_SCATTER's run and of the two above it. */
const Q_BARREL = 24;

/** Material piles a construction site scatters inside its fence. */
const SCATTER_MIN = 3;
const SCATTER_SPAN = 3;

/**
 * WHICH SIDES OF ITS BLOCK A CONSTRUCTION SITE FENCES OFF - the city's answer to Mossy's
 * SHAPE_CDF, and it exists for the same reason.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS IS NOT ONE SHAPE
 * ---------------------------------------------------------------------------------------------
 * Every site used to be the SAME square: a complete ring around the whole block, with a gap cut
 * in it. Only the gap moved. So the map's one breakable read as a single repeated object, and a
 * player who had seen one site had seen all of them - while Mossy Mayhem, whose breakables are
 * dealt a line, an L, a T or a room with rolled dimensions, gets a dozen distinct pieces out of
 * the same budget.
 *
 * A SIDE MASK RATHER THAN A SHAPE STAMPER, because a block is only 8 cells across and its wall
 * ring is one cell thick: there is no room in it for the free shapes Mossy draws across an
 * unbounded plane. What there IS room for is which of the four runs get built, and that turns out
 * to be the whole of it - four silhouettes that read completely differently from the street:
 *
 *   HOARDING  all four sides. The site as it was: sealed, and entered through a cut gateway.
 *   OPEN      three sides. The missing run IS the way in, so the site needs no gateway at all -
 *             and it faces a different street on every block that deals it.
 *   ELL       two adjacent sides. A corner to fight around rather than a box to break into.
 *   LANE      two opposite sides. Two parallel runs with open ends: a corridor, which is the one
 *             silhouette that channels a chase rather than blocking it.
 *
 * CORNERS BELONG TO BOTH THEIR SIDES, which is what keeps an ELL an L: the cell where the two
 * runs meet is drawn if EITHER of them is built, so the shape turns a corner instead of coming
 * apart into two loose lines a cell short of each other.
 *
 * THE HOARDING STAYS DOMINANT. It is the silhouette that says "construction site" without any
 * help, and the other three read as variations on it rather than as three new things - which is
 * only true while it is the one you see most.
 */
const SITE_HOARDING = 0;
const SITE_OPEN = 1;
const SITE_ELL = 2;
const SITE_LANE = 3;
const SITE_CDF: readonly number[] = Object.freeze([
  0.4, // hoarding  40%
  0.66, // open     26%
  0.86, // ell      20%
  1.0, //  lane     14%
]);

/**
 * Side bits, in the SAME ORDER `inGateway` numbers its sides (0 top, 1 bottom, 2 left, 3 right).
 * Shared deliberately: a gateway is cut into a run, so the two have to agree about which run is
 * which or a gap lands on a side that was never built.
 */
const SIDE_TOP = 1;
const SIDE_BOTTOM = 2;
const SIDE_LEFT = 4;
const SIDE_RIGHT = 8;
const SIDES_ALL = SIDE_TOP | SIDE_BOTTOM | SIDE_LEFT | SIDE_RIGHT;

/** The four ways two ADJACENT runs can meet, indexed by the rotation roll. */
const ELL_PAIRS: readonly number[] = Object.freeze([
  SIDE_TOP | SIDE_LEFT,
  SIDE_TOP | SIDE_RIGHT,
  SIDE_BOTTOM | SIDE_LEFT,
  SIDE_BOTTOM | SIDE_RIGHT,
]);

/** Which runs of its ring this construction site builds. */
function siteSides(h: number): number {
  const roll = blockFrac(h, Q_SITE);
  let kind = SITE_LANE;
  for (let i = 0; i < SITE_CDF.length; i++) {
    if (roll < SITE_CDF[i]) {
      kind = i;
      break;
    }
  }
  if (kind === SITE_HOARDING) return SIDES_ALL;

  const r = blockInt(h, Q_SITE_ROT, 4);
  if (kind === SITE_OPEN) return SIDES_ALL & ~(1 << r);
  if (kind === SITE_ELL) return ELL_PAIRS[r];
  // A lane runs one way or the other; the four-way roll is halved rather than re-rolled so the
  // orientation stays independent of nothing else - one question, one fact.
  return r < 2 ? SIDE_TOP | SIDE_BOTTOM : SIDE_LEFT | SIDE_RIGHT;
}

/**
 * Which of the four runs a ring cell sits on - two of them, on a corner.
 *
 * Read against a side mask: the cell is built if ANY run it belongs to is. See SITE_CDF for why
 * that is the rule rather than "the run this cell is most on".
 */
function ringSides(thick: number, lx: number, ly: number): number {
  const n = CITY_BLOCK_CELLS;
  let m = 0;
  if (ly <= thick) m |= SIDE_TOP;
  if (ly >= n - 1 - thick) m |= SIDE_BOTTOM;
  if (lx <= thick) m |= SIDE_LEFT;
  if (lx >= n - 1 - thick) m |= SIDE_RIGHT;
  return m;
}

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

/**
 * The block's own layout in local cell (lx, ly), before drums are scattered over what it left open.
 *
 * Split from `blockCellKind` when the barrels arrived, so that "where does this block put its
 * walls" and "where does the ground get a drum" are two questions with one answer each - a drum
 * roll folded into the layout would have had to be repeated in all four of the early returns.
 */
function blockCellBase(h: number, lx: number, ly: number): number {
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
    // A COURTYARD IS ALWAYS THE COMPLETE RING, and always with exactly one way in. That is the
    // whole of what a courtyard is - see SITE_CDF, which deliberately does not apply here: the
    // silhouettes there are a site's, and a courtyard opened up on two sides is a plaza with
    // extra steps.
    if (type === BLOCK_COURTYARD) {
      if (inGateway(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly)) return CITY_EMPTY;
      return CITY_BUILDING;
    }

    // A construction site builds only the runs its silhouette calls for.
    const sides = siteSides(h);
    if ((ringSides(thick, lx, ly) & sides) === 0) return CITY_EMPTY;

    // GATEWAYS ONLY WHERE THERE IS SOMETHING TO CUT THROUGH. A site missing a whole run is
    // already open, and cutting a gap into one of the runs it DID build would spend the site's
    // one readable feature on a second door nobody needed - two ways in through a three-sided
    // hoarding reads as a fence that fell down rather than as a site with a gate.
    if (sides === SIDES_ALL) {
      if (inGateway(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly)) return CITY_EMPTY;
      // Sealed sites sometimes get a second way in; courtyards never do.
      if (
        blockFrac(h, Q_GATE2) < 0.5 &&
        inGateway(h, Q_GATE2_SIDE, Q_GATE2_ALONG, thick, lx, ly)
      ) {
        return CITY_EMPTY;
      }
    }
    return CITY_FENCE;
  }

  // Inside a construction site: a few material piles, at hashed cells strictly inside the fence.
  //
  // EXCEPT IN A GATEWAY'S AISLE. A pile is the same breakable kind as the fence, so one dealt into
  // the cell just behind the gap turned the gap into a wall you had to shoot anyway - the site
  // still had "one or two entrances" in the generator and none on screen. Keeping the gate's own
  // two lanes clear, at every depth, means a doorway is always a doorway: you can drive in, and
  // what you break once inside is a choice rather than the price of entry.
  if (type === BLOCK_CONSTRUCTION && ring > thick) {
    // ONLY A SEALED SITE HAS AN AISLE TO KEEP CLEAR. The guard below exists because a pile dealt
    // behind a gateway turns the gap into a wall you have to shoot; a site with a whole run
    // missing has no gap to block, so reserving a lane through it would be protecting a doorway
    // that is not there - and costing the site two cells of scatter for nothing.
    const sealed = siteSides(h) === SIDES_ALL;
    const secondGate = blockFrac(h, Q_GATE2) < 0.5;
    const inAisle =
      sealed &&
      (inGatewayLane(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly) ||
        (secondGate && inGatewayLane(h, Q_GATE2_SIDE, Q_GATE2_ALONG, thick, lx, ly)));
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

/**
 * WHAT THE BLOCK PUTS IN LOCAL CELL (lx, ly): the layout, plus any drum standing on it.
 *
 * A drum goes on ground the block left OPEN, which is what keeps it out of walls and - because
 * roads never reach a block layout at all - off the streets. Two cells are refused:
 *
 *   THE GATEWAY LANES, for the reason the material piles avoid them: a drum parked in a doorway
 *   is a doorway you have to shoot, and the "walk into every block" test would fail on it.
 *   THE BLOCK'S OWN CORNER at (0, 0), which is where four pavement runs meet - a drum there sits
 *   in the diagonal everything cuts across on its way round a block.
 */
function blockCellKind(h: number, lx: number, ly: number): number {
  const base = blockCellBase(h, lx, ly);
  if (base !== CITY_EMPTY) return base;
  if (lx === 0 && ly === 0) return CITY_EMPTY;
  const thick = RING_THICKNESS;
  if (inGatewayLane(h, Q_GATE_SIDE, Q_GATE_ALONG, thick, lx, ly)) return CITY_EMPTY;
  if (blockFrac(h, Q_GATE2) < 0.5 && inGatewayLane(h, Q_GATE2_SIDE, Q_GATE2_ALONG, thick, lx, ly)) {
    return CITY_EMPTY;
  }
  return cellFrac(h, lx, ly, Q_BARREL) < CITY_BARREL_SHARE ? CITY_BARREL : CITY_EMPTY;
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
/**
 * PUTS ONE BROKEN DRUM BACK, and returns its cell key - which is also the index every generic
 * `scenery*` accessor decodes, so the caller reads its position and radius the same way it does
 * for the Scrapyard's.
 *
 * ---------------------------------------------------------------------------------------------
 * DRUMS ONLY. FENCES STAY DOWN.
 * ---------------------------------------------------------------------------------------------
 * `broken` holds both breakables under one key with no kind beside it, so the kind is recomputed
 * from the hash - which is cheap and, more to the point, is the only thing that can tell them
 * apart. A site you opened stays open: the shortcut is the reward, and a fence that grew back
 * would take it away from a player who had already paid for it in ammunition.
 *
 * ---------------------------------------------------------------------------------------------
 * SORTED BEFORE PICKING, AND THAT IS NOT TIDINESS
 * ---------------------------------------------------------------------------------------------
 * The candidates come out of a hash set. A JavaScript `Set` iterates in INSERTION order and a C#
 * `HashSet` iterates in whatever order it likes, so "the nth candidate" means two different cells
 * in the two languages and the replay diverges the first time a drum comes back. Sorting the keys
 * imposes a TOTAL order that neither container gets a say in - the same reasoning `readyAscension`
 * gives for taking the lowest catalog index rather than the first one it happens to reach.
 *
 * It costs an allocation and a sort once every `barrelRegrowSec`, against a set holding only what
 * this run has actually broken.
 */
export function regrowCityBarrel(
  c: CityBlocks,
  rng: Rng,
  px: number,
  py: number,
  minDist: number,
): number {
  const min2 = minDist * minDist;
  const eligible: number[] = [];

  for (const key of c.broken) {
    const cx = cityCellX(key);
    const cy = cityCellY(key);
    // The kind the GENERATOR gives this cell, with `broken` deliberately not consulted: every key
    // in here is broken by definition, so asking `cityKindAt` would answer CITY_EMPTY for all of
    // them and nothing would ever come back.
    const bx = blockIndexOf(cx);
    const by = blockIndexOf(cy);
    const lx = localOf(cx) - CITY_ROAD_CELLS;
    const ly = localOf(cy) - CITY_ROAD_CELLS;
    if (blockCellKind(hashBlock(c.seed, bx, by), lx, ly) !== CITY_BARREL) continue;

    const dx = cityCentre(cx) - px;
    const dy = cityCentre(cy) - py;
    if (dx * dx + dy * dy < min2) continue;
    eligible.push(key);
  }
  if (eligible.length === 0) return -1;

  eligible.sort((a, b) => a - b);
  const key = eligible[rng.nextInt(eligible.length)];
  c.broken.delete(key);
  // The half-damaged tally too, or the drum comes back already hurt by the shots that killed it.
  c.hurt.delete(key);
  c.version++;
  return key;
}

export function cityKindAt(c: CityBlocks, cx: number, cy: number): number {
  if (cityIsRoad(cx, cy)) return CITY_EMPTY;
  const bx = blockIndexOf(cx);
  const by = blockIndexOf(cy);
  const lx = localOf(cx) - CITY_ROAD_CELLS;
  const ly = localOf(cy) - CITY_ROAD_CELLS;
  const kind = blockCellKind(hashBlock(c.seed, bx, by), lx, ly);
  // Both breakables consult it. A drum that stayed in the grid after it went up would be an
  // invisible collider standing in the street forever, and would re-pay its loot on every touch.
  if ((kind === CITY_FENCE || kind === CITY_BARREL) && c.broken.has(cellKey(cx, cy))) {
    return CITY_EMPTY;
  }
  return kind;
}

/**
 * WHAT WOULD BE IN CELL (cx, cy) IF NOTHING HAD EVER BEEN BROKEN. The generated terrain, before
 * the broken set is applied.
 *
 * The dressing needs this and only the dressing: once broken, a fence cell and a drum cell are
 * both CITY_EMPTY and `isCityBroken` says yes to both, so with nothing else to ask, a drum that
 * went up left a heap of splintered fence boards lying in the street. A drum leaves a scorch mark
 * (the effects layer draws one off EV_BARREL_BROKEN) and nothing else.
 *
 * NOT FOR THE SIMULATION, ever: collision, rays and loot must all see the one world `cityKindAt`
 * reports, or a broken fence starts blocking shells again.
 */
export function cityPristineKindAt(c: CityBlocks, cx: number, cy: number): number {
  if (cityIsRoad(cx, cy)) return CITY_EMPTY;
  const lx = localOf(cx) - CITY_ROAD_CELLS;
  const ly = localOf(cy) - CITY_ROAD_CELLS;
  return blockCellKind(hashBlock(c.seed, blockIndexOf(cx), blockIndexOf(cy)), lx, ly);
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
function cellDist2(cx: number, cy: number, x: number, y: number, half = CITY_HALF): number {
  const mx = cityCentre(cx);
  const my = cityCentre(cy);
  const dx = Math.abs(x - mx) - half;
  const dy = Math.abs(y - my) - half;
  const ex = dx > 0 ? dx : 0;
  const ey = dy > 0 ? dy : 0;
  return ex * ex + ey * ey;
}

/**
 * The half-extent of a cell's collider. A wall or a fence fills its cell; a DRUM does not - it is
 * a lone object standing on the ground, so it gets the Scrapyard's measured 20 u instead of the
 * cell's 32. Written as one function because every query below has to agree about it: a barrel
 * that stopped shells at one size and the mech at another is the kind of mismatch nobody sees
 * until they are standing next to it.
 */
function cellHalf(kind: number): number {
  return kind === CITY_BARREL ? CITY_BARREL_HALF : CITY_HALF;
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
      const kind = cityKindAt(c, cx, cy);
      if (kind === CITY_EMPTY) continue;
      const d2 = cellDist2(cx, cy, x, y, cellHalf(kind));
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
      const kind = cityKindAt(c, cx, cy);
      // Both breakables: a fence spends its section pool, a drum goes over on contact.
      if (kind !== CITY_FENCE && kind !== CITY_BARREL) continue;
      const d2 = cellDist2(cx, cy, x, y, cellHalf(kind));
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
    let bestHalf = CITY_HALF;
    let found = false;
    for (let cy = r0; cy <= r1; cy++) {
      for (let cx = c0; cx <= c1; cx++) {
        const kind = cityKindAt(c, cx, cy);
        if (kind === CITY_EMPTY) continue;
        const half = cellHalf(kind);
        const d2 = cellDist2(cx, cy, px, py, half);
        if (d2 >= bestD2) continue;
        bestD2 = d2;
        bestCx = cx;
        bestCy = cy;
        bestHalf = half;
        found = true;
      }
    }
    if (!found) break;

    // The collider's own box, which for a drum is inset from the cell - see `cellHalf`. Everything
    // below is written against these four numbers, so the smaller box needs no special case.
    const mx = cityCentre(bestCx);
    const my = cityCentre(bestCy);
    const x0 = mx - bestHalf;
    const y0 = my - bestHalf;
    const x1 = mx + bestHalf;
    const y1 = my + bestHalf;

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
  /**
   * A second kind that also counts, or -1. Exists for the destructibles: a beam is stopped by a
   * site fence AND by a drum, and walking the grid twice to ask about each would let a fence
   * beyond a barrel win.
   */
  want2 = -1,
): number {
  let cx = cityCellOf(ox);
  let cy = cityCellOf(oy);
  const wanted = (k: number): boolean => k === want || k === want2;

  if (wanted(cityKindAt(c, cx, cy))) {
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
    if (wanted(cityKindAt(c, cx, cy))) {
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
  // Both breakables. The drum's collider is inset from its cell (see `cellHalf`) and this walks
  // whole cells, so a beam can stop up to 12 u short of the paint - invisible on a barrel that is
  // about to go up anyway, and the alternative is a per-cell ray-box clip in the hot loop.
  const t = rayWalk(c, ox, oy, dx, dy, maxT, CITY_FENCE, CITY_BARREL);
  rayHitT = t;
  if (t < 0) return -1;
  return packCityCell(rayCellX, rayCellY);
}

/** True when a standing drum occupies this cell. The dressing draws one; `breakLootIn` pays out. */
export function cityIsBarrel(c: CityBlocks, cx: number, cy: number): boolean {
  return cityKindAt(c, cx, cy) === CITY_BARREL;
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
  // A DRUM HAS NO SECTIONS. It is whole or it is gone, so it never draws the dimmed half state -
  // and it must not, or a barrel would advertise damage it cannot take.
  if (cityKindAt(c, cx, cy) === CITY_BARREL) return FENCE_SECTIONS;
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

  // A DRUM IGNORES THE AMOUNT, exactly as the Scrapyard's does: it is a thing you set off, not a
  // thing you grind down. Any damage that reaches it takes it, and it reports one "section" so the
  // caller's per-section event loop fires once.
  if (cityKindAt(c, cityCellX(i), cityCellY(i)) === CITY_BARREL) {
    breakCityCell(c, i);
    return 1;
  }

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
