/**
 * SCENERY - a level's standing terrain, and every query anything makes about it.
 *
 * TWO TERRAINS ANSWER THESE QUESTIONS. The Scrapyard's scrap piles are described at length below
 * and implemented here; Mossy Mayhem's unbounded wall lattice lives in `wallsMossy.ts` and is
 * dispatched to from each query. See `Scenery` for why that is a tagged union rather than the
 * feature flag `levels.ts` forbids.
 *
 * Generated once at `createWorld` from the run seed. It is world DATA, not a system: nothing here
 * runs per tick, and there is no `updateScenery`. Movement, projectiles and the lasers all ask it
 * questions instead.
 *
 * ONE THING MUTATES IT, and only one: a FUEL BARREL (variant 6) is destructible, and breaking it
 * sets its radius to 0. That single write removes it from collision, from the ray queries and from
 * the renderer at once, because all three already skip zero-radius cells - which is the whole
 * reason destruction is a radius write rather than a `destroyed` array nothing else would read.
 *
 * ---------------------------------------------------------------------------------------------
 * A JITTERED GRID, WHICH IS WHAT MAKES EVERY LOOKUP O(1)
 * ---------------------------------------------------------------------------------------------
 * The yard is cut into SCENERY_CELL squares and each cell holds AT MOST ONE pile, placed by two
 * random draws inside the middle of its own cell. That buys three things at once, and the last one
 * is the reason this is not simply a list:
 *
 *   - Density is uniform by construction. A rejection-sampled scatter clumps, and a clump of
 *     scrap in a bullet-heaven is a wall the player did not agree to.
 *   - "Which pile is near (x, y)" is arithmetic, not a search. No spatial structure, no rebuild,
 *     nothing added to the per-tick cost of anything.
 *   - NO TWO PILES CAN EVER OVERLAP, and therefore nothing in the game can ever be inside two at
 *     once. The jitter is clamped to +-SCENERY_JITTER of the cell centre, so the closest two
 *     neighbours can be is SCENERY_CELL - 2 * SCENERY_JITTER = 308 u, against a largest possible
 *     pair of radii of 180 u. Every collision routine below can therefore resolve against ONE
 *     circle and stop, which is what keeps them branch-free enough to sit in the movement loop.
 *
 * ---------------------------------------------------------------------------------------------
 * DENSITY, AND WHY IT IS THIS LOW
 * ---------------------------------------------------------------------------------------------
 * "Mostly open, with the occasional scrap pile." At a 768 u cell and a 0.55 fill the mean spacing
 * is about 1035 u, against a screen that shows at most 500.9 u from the player. So the common case
 * is one pile in view, often none, occasionally two - furniture to fight around rather than a maze
 * to navigate. A bullet-heaven whose ground is cluttered stops being about the horde.
 */

import { ARENA_HALF, ARENA_SIZE } from '../constants.js';
import { Rng } from '../rng.js';
import {
  breakWallCell,
  damageWallCell,
  pushOutOfWalls,
  wallCellX,
  wallCellY,
  wallCentre,
  wallDestructibleOverlap,
  wallDestructibleRayHit,
  wallLastRayT,
  wallOverlap,
  wallRayHit,
  WALL_HALF,
  WALL_TREE,
  wallKindAt,
  type MossWalls,
} from './wallsMossy.js';
import {
  breakCityCell,
  cityCellX,
  cityCellY,
  cityCentre,
  cityDestructibleOverlap,
  cityDestructibleRayHit,
  cityKindAt,
  cityLastRayT,
  cityOverlap,
  cityRayHit,
  CITY_FENCE,
  CITY_HALF,
  damageCityCell,
  pushOutOfCity,
  type CityBlocks,
} from './wallsCity.js';

/** Cell edge. One pile per cell, at most. 16 x 16 = 256 cells across a 12 288 u yard. */
export const SCENERY_CELL = 768;
export const SCENERY_COLS = ARENA_SIZE / SCENERY_CELL;

/**
 * Half-width of the jitter box inside each cell. Bounded rather than full-cell so that piles in
 * adjacent cells can never touch - see the header. Also keeps piles off the cell walls, which is
 * what stops the grid from being visible as a grid.
 */
const SCENERY_JITTER = 230;

/**
 * Chance a cell holds a pile at all.
 *
 * RAISED WITH THE BARREL SHARE, AND THE TWO MOVE TOGETHER. Doubling the drums by widening their
 * slice of `VARIANT_CDF` alone would have taken the extra barrels OUT of the other six piles -
 * same number of objects, a quarter fewer wrecks - which is not what "more barrels" means. So the
 * yard holds more cells (0.55 -> 0.671) AND barrels take a bigger share of them, sized so the six
 * unbreakable piles come out at exactly the count they had before and the drums come out at twice
 * theirs. Measured, not derived: see the note on VARIANT_CDF.
 */
const SCENERY_FILL = 0.7315;

const RADIUS_MIN = 45;
const RADIUS_MAX = 90;

/**
 * How many distinct pile sprites the renderer has.
 *
 *   0 crushed cars        1 barrel cluster      2 girder heap
 *   3 tyres and rubble    4 WRECKED ENEMIES     5 A WRECKED MECH
 *   6 FUEL BARREL - the one destructible, and the only one that gives anything back
 */
export const SCENERY_VARIANTS = 7;

export const SCRAP_ENEMY_WRECK = 4;
export const SCRAP_MECH_WRECK = 5;
export const SCRAP_BARREL = 6;

/**
 * A lone drum, not a heap, so it is fixed SMALL rather than drawn from the pile range. Size is how
 * the player tells at a glance that this one is different from the six things they cannot break.
 *
 * 20 u, down from 30: at 30 a drum was 60 u across against a 58 u mech, which read as a small pile
 * rather than as a barrel and made it a real obstacle to walk around. At 20 it is comfortably
 * smaller than the machine that walks into it, which is what a drum should be.
 */
const BARREL_RADIUS = 20;

/**
 * Cumulative weights for the variant draw. NOT uniform, and the shape is the point.
 *
 * The last two are the yard's STORYTELLING, and story is worth less the more of it there is. A
 * dead enemy hull says the horde has been coming through here for a long time and is common
 * enough to be part of the furniture. A dead MECH says someone exactly like you stood here and
 * lost - and at one pile in thirty three that is a thing you come across two or three times in a
 * run and stop at. At one in six it would be wallpaper, and the yard would read as a graveyard
 * for player mechs specifically, which is a different and much sillier place.
 *
 * The four junk variants stay dominant because the yard's job is to be a scrapyard first and a
 * memorial second.
 *
 * FUEL BARRELS are the exception to "rarer is better", because they are the only pile that gives
 * anything back and there are three things they can give - four counting the empty. They started
 * at 8%, which the reference run turned into four broken in fifteen minutes: under two of each
 * kind, and a player could finish a run having never seen a magnet.
 *
 * At 22% they are the most common thing in the yard, and that is the right shape now that they are
 * SMALL and sometimes EMPTY. A drum is no longer a landmark you cross the map for; it is something
 * you clip on the way past and are mildly pleased about. Objects like that have to be plentiful or
 * the habit never forms - and the empty roll is what stops plentiful from meaning guaranteed.
 */
/**
 * DRUMS ARE DOUBLED AND NOTHING ELSE MOVED.
 *
 * The six unbreakable piles keep their proportions to one another exactly - every cutoff below is
 * the old one times 0.8197 - and their SHARE shrinks only because the pool of occupied cells grew
 * by the same factor. `SCENERY_FILL` went 0.55 -> 0.671 to pay for it, so:
 *
 *                     share of cells    piles per yard (before culling)
 *   six unbreakables  0.429 -> 0.429    110 -> 110
 *   FUEL BARRELS      0.121 -> 0.242     31 ->  62
 *
 * Measured across three seeds after the clear-radius and fence culls, which is the check that
 * matters because those culls are what the arithmetic above cannot see:
 *
 *   drums         32 -> 64,  26 -> 60,  34 -> 70     (2.11x over the three)
 *   unbreakables 116 -> 115, 112 -> 107, 100 -> 99   (unchanged, to within a pile)
 */
/**
 * AND THEN DRUMS WENT UP ANOTHER QUARTER, by exactly the same manoeuvre, so this table now records
 * two edits with one method. `SCENERY_FILL` 0.671 -> 0.7315 and every unbreakable cutoff times
 * 0.9173, which holds `fill x unbreakableShare` at 0.4290 - the count those six were measured at -
 * while `fill x barrelShare` goes 0.2420 -> 0.3025.
 *
 * THE POINT OF DOING IT THIS WAY rather than just raising the fill: the six piles are COVER and
 * COLLISION, and their density is a fact about how the yard plays that somebody measured. A drum
 * is loot. Making loot commoner should not quietly make the map more cluttered as well, and a bare
 * fill increase would have added 9% more girders to pay for 9% more barrels.
 */
const VARIANT_CDF: readonly number[] = Object.freeze([
  0.1278, // 0 crushed cars    12.78%
  0.2556, // 1 barrels         12.78%
  0.3834, // 2 girders         12.78%
  0.4963, // 3 tyres           11.29%
  0.5639, // 4 enemy wrecks     6.76%
  0.5864, // 5 mech wreck       2.25%
  1.0, // 6 FUEL BARREL        41.36%
]);

/**
 * No scrap within this of the origin. The player starts at (0, 0) and must not open a run wedged
 * against a wreck, or - worse - inside one.
 */
const CLEAR_RADIUS = 420;

/**
 * Derived from the run seed rather than drawn from any live stream. The yard has to be identical
 * for a given seed, and generating it from `rng.spawn` would mean every future change to how much
 * scrap exists silently reshuffles every enemy in every replay.
 */
const SCENERY_SEED_MIX = 0x5ce7e12 | 0;

/**
 * THE SCRAPYARD'S TERRAIN: circles on a jittered grid. Everything above describes this one.
 */
export interface ScrapPiles {
  readonly kind: 'piles';
  /** Indexed by `row * SCENERY_COLS + col`. `radius` 0 means the cell is empty. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  /** Which sprite to draw, 0..SCENERY_VARIANTS-1. */
  readonly variant: Int32Array;
  /** How many cells actually hold a pile. Diagnostics and the harness; nothing branches on it. */
  count: number;
  /** Bumped by every write that changes what is standing. See `sceneryVersion`. */
  version: number;
}

/**
 * TERRAIN, WHICHEVER SHAPE THIS LEVEL'S IS.
 *
 * ---------------------------------------------------------------------------------------------
 * A TAGGED UNION, WHICH IS NOT THE SAME THING AS A FEATURE FLAG
 * ---------------------------------------------------------------------------------------------
 * `levels.ts` is emphatic that a level supplies its parts rather than ticking boxes, and this looks
 * at first glance like the boolean that document forbids. It is the opposite of one, and the
 * difference is worth stating because the next person to add terrain will have to decide the same
 * thing:
 *
 *   - A FLAG switches shared behaviour on and off, so content can only ever differ in ways somebody
 *     already anticipated, and the `if` lands in the middle of code other levels depend on.
 *   - THIS is two unrelated geometries - circles on a bounded grid, cells on an unbounded lattice -
 *     that happen to answer the same six questions. The discrimination is on WHAT THE DATA IS, it
 *     lives entirely inside this module, and it appears exactly once per question.
 *
 * The evidence that it is the right shape: not one system changed. `playerMovement`, `enemyAI`,
 * `spawning`, `projectiles` and `weapons` still call `pushOutOfScenery` and `sceneryRayHit` and
 * have no idea there are two kinds of ground. Had this been a flag, every one of them would carry
 * it.
 *
 * A third terrain is a third member and six more branches here, and still no system edits.
 *
 * AND HERE IT IS: City Chaos's road grid, `wallsCity.ts`. As predicted - a third member, a
 * branch per question below, and not one system touched.
 */
export type Scenery = ScrapPiles | MossWalls | CityBlocks;

/**
 * An allocated but EMPTY world. Used by a level that generates its terrain some other way, or not
 * yet at all.
 *
 * A complete `Scenery` rather than a special case: `count` 0 means every overlap query returns -1
 * and every push misses, so no system needs to know whether a level has anything in it.
 */
export function emptyScenery(): ScrapPiles {
  const n = SCENERY_COLS * SCENERY_COLS;
  return {
    kind: 'piles',
    x: new Float32Array(n),
    y: new Float32Array(n),
    radius: new Float32Array(n),
    variant: new Int32Array(n),
    count: 0,
    version: 0,
  };
}

/**
 * THE SCRAPYARD'S generator, and it is the Scrapyard's rather than core's.
 *
 * Everything below fills a FIXED SQUARE - the cell grid is indexed from `-ARENA_HALF` and
 * `sceneryCell` maps a coordinate back the same way - so it is built on knowing where the world
 * stops. That is a property of one level, which is why the level catalog holds a `makeScenery`
 * function instead of a flag telling this one whether to bother.
 */
export function createScenery(seed: number): ScrapPiles {
  const s = emptyScenery();

  const rng = new Rng((seed ^ SCENERY_SEED_MIX) | 0);
  const clear2 = CLEAR_RADIUS * CLEAR_RADIUS;

  for (let row = 0; row < SCENERY_COLS; row++) {
    for (let col = 0; col < SCENERY_COLS; col++) {
      // Every cell draws the SAME NUMBER of values whether or not it ends up holding anything, so
      // that changing SCENERY_FILL moves which cells are occupied without also reshuffling where
      // the occupied ones sit.
      const roll = rng.nextFloat();
      const jx = rng.nextRange(-SCENERY_JITTER, SCENERY_JITTER);
      const jy = rng.nextRange(-SCENERY_JITTER, SCENERY_JITTER);
      let r = rng.nextRange(RADIUS_MIN, RADIUS_MAX);
      const variant = pickVariant(rng.nextFloat());
      if (roll >= SCENERY_FILL) continue;

      // A dead mech is a LANDMARK, so it is never one of the small ones. Biased rather than drawn
      // from its own range, which would cost a second draw and shift the stream: the size roll has
      // already happened, this only refuses to let it come out puny.
      if (variant === SCRAP_MECH_WRECK && r < RADIUS_MAX * 0.82) r = RADIUS_MAX * 0.82;
      if (variant === SCRAP_BARREL) r = BARREL_RADIUS;

      const cx = -ARENA_HALF + (col + 0.5) * SCENERY_CELL + jx;
      const cy = -ARENA_HALF + (row + 0.5) * SCENERY_CELL + jy;

      // Nothing in the player's opening, and nothing overhanging the fence.
      if (cx * cx + cy * cy < clear2) continue;
      if (Math.abs(cx) + r > ARENA_HALF || Math.abs(cy) + r > ARENA_HALF) continue;

      const i = row * SCENERY_COLS + col;
      s.x[i] = cx;
      s.y[i] = cy;
      s.radius[i] = r;
      s.variant[i] = variant;
      s.count++;
    }
  }

  return s;
}

/**
 * Variant for a roll in [0, 1). Linear scan over six entries - a binary search would be slower
 * and this runs 256 times, once, at world creation.
 */
function pickVariant(roll: number): number {
  for (let i = 0; i < VARIANT_CDF.length; i++) {
    if (roll < VARIANT_CDF[i]) return i;
  }
  return VARIANT_CDF.length - 1;
}

/** Cell index for a world coordinate, clamped to the grid. */
function cellOf(v: number): number {
  const c = Math.floor((v + ARENA_HALF) / SCENERY_CELL);
  return c < 0 ? 0 : c > SCENERY_COLS - 1 ? SCENERY_COLS - 1 : c;
}

/**
 * The pile overlapping the circle (x, y, r), or -1.
 *
 * Walks the 3x3 cell neighbourhood, which is exact: a pile is at most RADIUS_MAX from its own
 * cell's jitter box, so nothing outside the neighbouring cells can reach a circle in this one for
 * any radius the game actually uses. Returns on the first hit because piles cannot overlap, so
 * there is never a second.
 */
export function sceneryOverlap(s: Scenery, x: number, y: number, r: number): number {
  if (s.kind === 'walls') return wallOverlap(s, x, y, r);
  if (s.kind === 'city') return cityOverlap(s, x, y, r);
  const c0 = cellOf(x);
  const r0 = cellOf(y);

  for (let dr = -1; dr <= 1; dr++) {
    const row = r0 + dr;
    if (row < 0 || row >= SCENERY_COLS) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const col = c0 + dc;
      if (col < 0 || col >= SCENERY_COLS) continue;
      const i = row * SCENERY_COLS + col;
      const pr = s.radius[i];
      if (pr === 0) continue;
      const dx = x - s.x[i];
      const dy = y - s.y[i];
      const reach = pr + r;
      if (dx * dx + dy * dy < reach * reach) return i;
    }
  }
  return -1;
}

/**
 * Result of pushing a moving circle out of a pile. Module-level and reused: this is called from
 * the movement loops, which allocate nothing.
 *
 * It is safe as module scratch only because it never survives the call that fills it - both
 * callers read it immediately. Anything that wanted to hold it across a call would have to copy.
 */
export interface SceneryPush {
  x: number;
  y: number;
  /** Unit normal out of the pile. Zero when nothing was hit. */
  nx: number;
  ny: number;
  hit: boolean;
}

const PUSH: SceneryPush = { x: 0, y: 0, nx: 0, ny: 0, hit: false };

/**
 * Slides a circle out of whatever pile it has entered, along the shortest path.
 *
 * The normal is returned rather than the velocity being edited here, because the two callers want
 * different things from it: the player kills the inward component (so the mech stops dead against
 * scrap, exactly as it does against the fence) while an enemy keeps the tangent and WALKS AROUND.
 * That difference is the whole reason enemies do not simply pile up against the back of a wreck
 * forever - they have no pathfinding, so the slide is their only way past anything.
 *
 * A circle exactly at a pile's centre has no direction to leave by; it is pushed out along +x,
 * which is arbitrary but deterministic.
 */
export function pushOutOfScenery(
  s: Scenery,
  x: number,
  y: number,
  r: number,
): Readonly<SceneryPush> {
  if (s.kind === 'walls') return pushOutOfWalls(s, x, y, r);
  if (s.kind === 'city') return pushOutOfCity(s, x, y, r);
  PUSH.x = x;
  PUSH.y = y;
  PUSH.nx = 0;
  PUSH.ny = 0;
  PUSH.hit = false;

  const i = sceneryOverlap(s, x, y, r);
  if (i < 0) return PUSH;

  const dx = x - s.x[i];
  const dy = y - s.y[i];
  const reach = s.radius[i] + r;
  const d2 = dx * dx + dy * dy;

  let nx: number;
  let ny: number;
  if (d2 === 0) {
    nx = 1;
    ny = 0;
  } else {
    const inv = 1 / Math.sqrt(d2);
    nx = dx * inv;
    ny = dy * inv;
  }

  PUSH.x = s.x[i] + nx * reach;
  PUSH.y = s.y[i] + ny * reach;
  PUSH.nx = nx;
  PUSH.ny = ny;
  PUSH.hit = true;
  return PUSH;
}

/**
 * Distance along the ray (ox, oy) + t * (dx, dy) at which it first enters a pile, or -1 within
 * `maxT`. `(dx, dy)` must be a unit vector.
 *
 * THIS IS WHAT STOPS A LASER FIRING INTO A WRECK. The lasers check it before paying any heat, so
 * an occluded target is not a wasted burst - it is no burst at all, and the weapon stays cold for
 * the moment the player steps around the obstruction.
 *
 * FUEL BARRELS ARE NOT COUNTED, and that exemption is load-bearing rather than an optimisation. A
 * barrel is meant to be destroyed by any weapon that hits it; if it occluded like everything else
 * the lasers would refuse to fire at it, and the one weapon family that burns continuously could
 * never break one. Excluded here, they are instead swept by `destructibleRayHit` after the shot -
 * so a beam passes through a drum and takes it with it.
 *
 * The 3x3 neighbourhood is taken about the ray's MIDPOINT and widened by half its length, which
 * covers every cell a beam can cross: the longest laser reaches 473 u against a 768 u cell, so a
 * ray spans at most two cells per axis and the padded neighbourhood contains all of them.
 */
export function sceneryRayHit(
  s: Scenery,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  if (s.kind === 'walls') return wallRayHit(s, ox, oy, dx, dy, maxT);
  if (s.kind === 'city') return cityRayHit(s, ox, oy, dx, dy, maxT);
  const c0 = cellOf(ox + dx * maxT * 0.5);
  const r0 = cellOf(oy + dy * maxT * 0.5);
  // Cells to either side of the midpoint that the ray can still touch. Half the ray plus the
  // largest pile, in cells, rounded up.
  const span = 1 + Math.floor((maxT * 0.5 + RADIUS_MAX) / SCENERY_CELL);

  let best = -1;
  for (let dr = -span; dr <= span; dr++) {
    const row = r0 + dr;
    if (row < 0 || row >= SCENERY_COLS) continue;
    for (let dc = -span; dc <= span; dc++) {
      const col = c0 + dc;
      if (col < 0 || col >= SCENERY_COLS) continue;
      const i = row * SCENERY_COLS + col;
      const pr = s.radius[i];
      if (pr === 0) continue;
      if (s.variant[i] === SCRAP_BARREL) continue;

      // Ray-circle, solved on the projection rather than with a quadratic: `t` is where the ray
      // passes closest to the centre, and the perpendicular distance there decides whether it
      // enters at all.
      const mx = s.x[i] - ox;
      const my = s.y[i] - oy;
      const t = mx * dx + my * dy;
      const perp2 = mx * mx + my * my - t * t;
      const pr2 = pr * pr;
      if (perp2 >= pr2) continue;

      // Entry point: closest approach minus the half-chord.
      const entry = t - Math.sqrt(pr2 - perp2);
      // `entry < 0` with perp inside the radius means the ray STARTS inside this pile, which the
      // player cannot do (they are pushed out every tick) but a future emitter might.
      const at = entry < 0 ? 0 : entry;
      if (at > maxT) continue;
      if (best < 0 || at < best) best = at;
    }
  }
  return best;
}

/** True if this cell holds something a weapon can break. */
export function isDestructible(s: Scenery, i: number): boolean {
  if (s.kind === 'walls') return wallKindAt(s, wallCellX(i), wallCellY(i)) === WALL_TREE;
  if (s.kind === 'city') return cityKindAt(s, cityCellX(i), cityCellY(i)) === CITY_FENCE;
  return s.radius[i] > 0 && s.variant[i] === SCRAP_BARREL;
}

/**
 * The DESTRUCTIBLE cell overlapping the circle (x, y, r), or -1.
 *
 * Separate from `sceneryOverlap` rather than a flag on it, because the two questions have
 * different answers on purpose: a shell asks "did I hit anything" (everything counts) and then
 * asks "was it breakable" (only the barrel does). Splash asks only the second, over a radius wide
 * enough to catch several - so this one keeps scanning instead of returning on the first hit, and
 * reports the NEAREST, which is the one a blast centred anywhere should take out first.
 */
export function destructibleOverlap(s: Scenery, x: number, y: number, r: number): number {
  if (s.kind === 'walls') return wallDestructibleOverlap(s, x, y, r);
  if (s.kind === 'city') return cityDestructibleOverlap(s, x, y, r);
  const c0 = cellOf(x);
  const r0 = cellOf(y);

  let best = -1;
  let bestD2 = 0;
  for (let dr = -1; dr <= 1; dr++) {
    const row = r0 + dr;
    if (row < 0 || row >= SCENERY_COLS) continue;
    for (let dc = -1; dc <= 1; dc++) {
      const col = c0 + dc;
      if (col < 0 || col >= SCENERY_COLS) continue;
      const i = row * SCENERY_COLS + col;
      if (s.variant[i] !== SCRAP_BARREL) continue;
      const pr = s.radius[i];
      if (pr === 0) continue;
      const dx = x - s.x[i];
      const dy = y - s.y[i];
      const d2 = dx * dx + dy * dy;
      const reach = pr + r;
      if (d2 >= reach * reach) continue;
      if (best < 0 || d2 < bestD2) {
        best = i;
        bestD2 = d2;
      }
    }
  }
  return best;
}

/**
 * Removes a pile from the world. ONE WRITE, and it is a radius rather than a flag precisely so
 * that collision, the laser ray and the renderer all forget about it without any of them learning
 * a new concept.
 */
/**
 * Puts damage into a destructible piece. Returns how many TREES that hit felled - 0 or more on the
 * moss, and always 1 on the Scrapyard, where a drum has no hit points and any contact takes it.
 *
 * THE DAMAGE IS IGNORED BY A BARREL, deliberately. A drum is a thing you set off, not a thing you
 * grind down: it goes over when the mech walks into it and when a stray round finds it, and giving
 * it a health bar would turn the one piece of scenery you break BY ACCIDENT into a target.
 */
export function damageScenery(s: Scenery, i: number, amount: number): number {
  if (s.kind === 'walls') return damageWallCell(s, i, amount);
  if (s.kind === 'city') return damageCityCell(s, i, amount);
  if (s.radius[i] === 0) return 0;
  destroyScenery(s, i);
  return 1;
}

export function destroyScenery(s: Scenery, i: number): void {
  if (s.kind === 'walls') return breakWallCell(s, i);
  if (s.kind === 'city') return breakCityCell(s, i);
  if (s.radius[i] === 0) return;
  s.radius[i] = 0;
  s.count--;
  s.version++;
}

/**
 * How far a drum must stand from the mech to come back. A hair past the camera's own reach
 * (500.9 u on the short axis), so a barrel is never seen standing up - it is always something
 * that was already there when the player arrived.
 */
export const BARREL_REGROW_MIN_DIST = 560;

/**
 * Stands ONE destroyed barrel back up, somewhere the player is not looking. Returns the cell it
 * revived, or -1 if there was nothing eligible.
 *
 * ---------------------------------------------------------------------------------------------
 * IT REVIVES A CELL RATHER THAN PLACING A NEW BARREL
 * ---------------------------------------------------------------------------------------------
 * `destroyScenery` zeroes the radius and touches nothing else, so a broken drum leaves its
 * position and its variant sitting in the grid. Reviving it is therefore one write, and it
 * inherits every guarantee the original layout was built with for free: it is on the jittered
 * grid, it is inside the fence, it is outside the player's opening, and it cannot overlap another
 * pile - because it is exactly where a barrel already stood.
 *
 * The alternative - rolling a fresh position - would need every one of those checks written a
 * second time, in a second place, and would let the yard slowly fill with drums in the gaps the
 * grid deliberately leaves.
 *
 * It also means the yard can never hold MORE barrels than it opened with, which is the property
 * that stops a long run turning the Scrapyard into a barrel farm.
 *
 * ---------------------------------------------------------------------------------------------
 * ONE RNG DRAW, WHATEVER THE CANDIDATE COUNT
 * ---------------------------------------------------------------------------------------------
 * Two passes - count the eligible cells, then draw one index into that count - rather than a
 * reservoir sample, which would spend a draw per candidate and make the stream's position depend
 * on how much of the yard the player happens to have cleared. Nothing is drawn at all when there
 * is nothing to revive, so an untouched yard never moves the stream.
 *
 * `variant === SCRAP_BARREL && radius === 0` identifies a BROKEN barrel and nothing else: a cell
 * that never held anything was `continue`d before its variant was written, so it is still 0
 * (cars), and no empty cell can be mistaken for a drum that was there.
 */
export function regrowBarrel(s: Scenery, rng: Rng, px: number, py: number): number {
  // Walls do not come back. See wallsMossy.ts: a wood the player cut through stays cut.
  // Nor do fences: a construction site the player opened stays open.
  if (s.kind === 'walls' || s.kind === 'city') return -1;
  const n = s.radius.length;
  const min2 = BARREL_REGROW_MIN_DIST * BARREL_REGROW_MIN_DIST;

  let eligible = 0;
  for (let i = 0; i < n; i++) {
    if (s.variant[i] !== SCRAP_BARREL || s.radius[i] !== 0) continue;
    const dx = s.x[i] - px;
    const dy = s.y[i] - py;
    if (dx * dx + dy * dy < min2) continue;
    eligible++;
  }
  if (eligible === 0) return -1;

  let pick = rng.nextInt(eligible);
  for (let i = 0; i < n; i++) {
    if (s.variant[i] !== SCRAP_BARREL || s.radius[i] !== 0) continue;
    const dx = s.x[i] - px;
    const dy = s.y[i] - py;
    if (dx * dx + dy * dy < min2) continue;
    if (pick-- > 0) continue;
    s.radius[i] = BARREL_RADIUS;
    s.count++;
    s.version++;
    return i;
  }
  return -1;
}

/**
 * The first DESTRUCTIBLE the ray enters, or -1. Same ray-circle maths as `sceneryRayHit` and the
 * exact complement of it: that one sees everything except barrels, this one sees only barrels.
 *
 * Used by the beams after they fire. A laser passes through a drum rather than being stopped by
 * it, and this is what notices, so the drum goes up as the beam sweeps across it.
 */
let lastRayT = -1;

/**
 * HOW FAR ALONG THE RAY the last `destructibleRayHit` found what it found, or -1.
 *
 * Module scratch, valid only until the next call - the same contract `SceneryPush` keeps, and for
 * the same reason: the beams need both the thing and its distance, and returning a pair would
 * allocate inside the firing loop.
 *
 * IT IS ONLY MEANINGFUL FOR A TREE. A barrel does not stop anything (see `breakLootIn`), so nothing
 * asks how far away one was; the piles branch fills this in anyway rather than leaving a stale value
 * behind for the next reader to trust.
 */
export function destructibleRayDistance(): number {
  return lastRayT;
}

export function destructibleRayHit(
  s: Scenery,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
  if (s.kind === 'walls') {
    const cell = wallDestructibleRayHit(s, ox, oy, dx, dy, maxT);
    lastRayT = wallLastRayT();
    return cell;
  }
  if (s.kind === 'city') {
    const cell = cityDestructibleRayHit(s, ox, oy, dx, dy, maxT);
    lastRayT = cityLastRayT();
    return cell;
  }
  const c0 = cellOf(ox + dx * maxT * 0.5);
  const r0 = cellOf(oy + dy * maxT * 0.5);
  const span = 1 + Math.floor((maxT * 0.5 + RADIUS_MAX) / SCENERY_CELL);

  let best = -1;
  let bestT = 0;
  for (let dr = -span; dr <= span; dr++) {
    const row = r0 + dr;
    if (row < 0 || row >= SCENERY_COLS) continue;
    for (let dc = -span; dc <= span; dc++) {
      const col = c0 + dc;
      if (col < 0 || col >= SCENERY_COLS) continue;
      const i = row * SCENERY_COLS + col;
      if (s.variant[i] !== SCRAP_BARREL) continue;
      const pr = s.radius[i];
      if (pr === 0) continue;

      const mx = s.x[i] - ox;
      const my = s.y[i] - oy;
      const t = mx * dx + my * dy;
      const perp2 = mx * mx + my * my - t * t;
      const pr2 = pr * pr;
      if (perp2 >= pr2) continue;

      const entry = t - Math.sqrt(pr2 - perp2);
      const at = entry < 0 ? 0 : entry;
      if (at > maxT) continue;
      if (best < 0 || at < bestT) {
        best = i;
        bestT = at;
      }
    }
  }
  lastRayT = best < 0 ? -1 : bestT;
  return best;
}

// -------------------------------------------------------------------------------------------
// Reading a cell back
// -------------------------------------------------------------------------------------------

/**
 * WHERE THE THING AT INDEX `i` IS, AND HOW BIG IT IS.
 *
 * Three accessors rather than the callers reaching into `s.x[i]`, because the index a query hands
 * back means different things to the two terrains - a slot in a flat array for the Scrapyard, a
 * packed cell coordinate for Mossy - and the callers have no business knowing which. They ask a
 * query for an index and hand that index straight back; this is the only place the difference
 * exists.
 *
 * It is also what let the barrel-breaking path stay one piece of code: it reads a position out of
 * whatever it hit and puts an event there, and both terrains answer.
 */
export function sceneryX(s: Scenery, i: number): number {
  if (s.kind === 'walls') return wallCentre(wallCellX(i));
  if (s.kind === 'city') return cityCentre(cityCellX(i));
  return s.x[i];
}

export function sceneryY(s: Scenery, i: number): number {
  if (s.kind === 'walls') return wallCentre(wallCellY(i));
  if (s.kind === 'city') return cityCentre(cityCellY(i));
  return s.y[i];
}

/** Sizes the burst the renderer plays where something went up. Half a cell, for a wall. */
export function sceneryRadius(s: Scenery, i: number): number {
  if (s.kind === 'walls') return WALL_HALF;
  if (s.kind === 'city') return CITY_HALF;
  return s.radius[i];
}

/**
 * A COUNTER THAT CHANGES WHENEVER THE TERRAIN DOES, and nothing else about it is meaningful - not
 * its value, not how fast it climbs. Only "is this the same number as last time".
 *
 * It exists so that anything holding a CACHE derived from the terrain can tell, in one comparison,
 * whether its copy is still good. The flow field is the only such thing today and it used to
 * manage without: it simply expired twice a second on the assumption that half a second of stale
 * terrain would not be noticed. That was true but wasteful in both directions - it rebuilt 120
 * times a minute while standing in an empty field where nothing had changed, and it still took up
 * to half a second to notice a tree coming down, which is exactly the moment a route opens and the
 * horde should use it.
 *
 * THE THREE WRITES ARE THE WHOLE LIST: `destroyScenery` and `regrowBarrel` here, and
 * `breakWallCell` in wallsMossy.ts. That is not a coincidence to be maintained by vigilance - the
 * header of this file has always said terrain is generated once and mutated in exactly one way per
 * kind, and `tests/flowField.test.ts` asserts that a felled tree is seen.
 */
export function sceneryVersion(s: Scenery): number {
  return s.version;
}
