/**
 * SCENERY - the scrap piles standing in the yard, and every query anything makes about them.
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

/** Cell edge. One pile per cell, at most. 16 x 16 = 256 cells across a 12 288 u yard. */
export const SCENERY_CELL = 768;
export const SCENERY_COLS = ARENA_SIZE / SCENERY_CELL;

/**
 * Half-width of the jitter box inside each cell. Bounded rather than full-cell so that piles in
 * adjacent cells can never touch - see the header. Also keeps piles off the cell walls, which is
 * what stops the grid from being visible as a grid.
 */
const SCENERY_JITTER = 230;

/** Chance a cell holds a pile at all. */
const SCENERY_FILL = 0.55;

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
 * A lone drum, not a heap, so it is fixed SMALL rather than drawn from the pile range - about a
 * mech's width across. Size is how the player tells at a glance that this one is different from
 * the six things they cannot break.
 */
const BARREL_RADIUS = 30;

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
 * anything back and there are THREE things they can give. At 8% the reference run broke four in
 * fifteen minutes, which is under two of each kind and means a player could finish a run having
 * never seen a magnet. 12% puts about eighteen in the yard and six in the ground a run covers -
 * often enough that each consumable is a thing you learn, rare enough that finding one is still
 * an event.
 */
const VARIANT_CDF: readonly number[] = Object.freeze([
  0.21, // 0 crushed cars      21%
  0.4, // 1 barrels            19%
  0.59, // 2 girders           19%
  0.76, // 3 tyres             17%
  0.85, // 4 enemy wrecks       9%
  0.88, // 5 mech wreck         3%
  1.0, // 6 FUEL BARREL        12%
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

export interface Scenery {
  /** Indexed by `row * SCENERY_COLS + col`. `radius` 0 means the cell is empty. */
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly radius: Float32Array;
  /** Which sprite to draw, 0..SCENERY_VARIANTS-1. */
  readonly variant: Int32Array;
  /** How many cells actually hold a pile. Diagnostics and the harness; nothing branches on it. */
  count: number;
}

export function createScenery(seed: number): Scenery {
  const n = SCENERY_COLS * SCENERY_COLS;
  const s: Scenery = {
    x: new Float32Array(n),
    y: new Float32Array(n),
    radius: new Float32Array(n),
    variant: new Int32Array(n),
    count: 0,
  };

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
export function destroyScenery(s: Scenery, i: number): void {
  if (s.radius[i] === 0) return;
  s.radius[i] = 0;
  s.count--;
}

/**
 * The first DESTRUCTIBLE the ray enters, or -1. Same ray-circle maths as `sceneryRayHit` and the
 * exact complement of it: that one sees everything except barrels, this one sees only barrels.
 *
 * Used by the beams after they fire. A laser passes through a drum rather than being stopped by
 * it, and this is what notices, so the drum goes up as the beam sweeps across it.
 */
export function destructibleRayHit(
  s: Scenery,
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  maxT: number,
): number {
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
  return best;
}
