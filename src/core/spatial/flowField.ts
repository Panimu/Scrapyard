/**
 * THE FLOW FIELD - one search from the player that every enemy reads, instead of every enemy
 * working out for itself how to get round a wall.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY THIS EXISTS: THE HORDE IS "ALL SOURCES, ONE DESTINATION"
 * ---------------------------------------------------------------------------------------------
 * Pathfinding problems are classified by how many starts and how many ends they have. A* is the
 * answer to ONE source and ONE destination. This game is the other shape entirely - three hundred
 * bodies, all heading for the same place - and for that the standard answer is to run a single
 * search FROM THE GOAL and let every agent read the result. It is called a flow field in RTS
 * circles (Supreme Commander 2, Planetary Annihilation) and a Dijkstra map in roguelike ones
 * (Brogue), and it is the same idea both times.
 *
 * What it replaces was a wall FOLLOWER - each body feeling its way round an obstacle from local
 * probes. That is the Bug family of algorithms from robotics, and it has a documented ceiling
 * rather than a fixable bug: local sensing cannot escape a local minimum, so there is always some
 * pocket a body settles in. Three rounds of fixes each solved one shape and failed on the next
 * (see the header of tests/enemyPathing.test.ts). A field cannot have that failure, because the
 * search that built it has already seen the whole neighbourhood.
 *
 * ---------------------------------------------------------------------------------------------
 * IT IS A WINDOW, AND THE WINDOW IS BIG ENOUGH BECAUSE THE HORDE IS ON A LEASH
 * ---------------------------------------------------------------------------------------------
 * Mossy Mayhem is unbounded, so a field over "the map" is not a thing that exists. It does not
 * need to be: `RELOCATE_RADIUS` (constants.ts) teleports any ordinary straggler that gets further
 * than 1000 u from the player back onto the spawn ring, so THE WHOLE HORDE LIVES IN A 1000 u DISC
 * whether it is on screen or not. FLOW_CELLS x FLOW_CELLS at 64 u is +-1536 u, which is that disc
 * with half as much again in margin.
 *
 * So "off screen" is not the same as "outside the field". An enemy behind a wall two screens away
 * is still inside the window, still gets a direction, and still arrives - which is the whole point
 * of a horde that is meant to apply pressure from every side.
 *
 * TWO THINGS ARE OUTSIDE IT, both deliberately. A BOSS is never relocated (outrunning a set-piece
 * is allowed to work), and anything else that has somehow got beyond the window. Both fall back to
 * the local follower in `seek`, which is exactly what a body with no better information should do.
 *
 * ---------------------------------------------------------------------------------------------
 * EVERYBODY DOES NOT TAKE THE SAME ROUTE
 * ---------------------------------------------------------------------------------------------
 * A field with one direction per cell steers every body in that cell identically, so a pack
 * rounding a wall files through the same gap one behind another. It does not have to: in a
 * distance field EVERY neighbour that is strictly closer is a valid route, because distance falls
 * by at least one each step and the walk therefore has to terminate. The search already computed
 * all of them and was keeping only the best.
 *
 * So `options` keeps the whole set and each body takes whichever member best matches its own fixed
 * lean on the bearing to the player (`flowDirFor`). Measured on the real lattice, 87.9% of
 * reachable cells offer two or more - the choice was always there, it was simply thrown away.
 *
 * ---------------------------------------------------------------------------------------------
 * COST, MEASURED
 * ---------------------------------------------------------------------------------------------
 * In a browser, on the real lattice, a full 48x48 rebuild is 96 us of cost-field sampling plus
 * 17 us of BFS. The whole simulation at 300 enemies is 496 us per tick against a 16 700 us frame,
 * so a rebuild is a fifth of one tick - and it does not happen every tick. See `updateFlowField`:
 * standing still it happens ONCE, and walking flat out about 254 times a minute, which is 8 us per
 * tick amortised. Squeezing it further was measured and rejected: at that share of a 700 us tick
 * there is nothing to win.
 *
 * IT IS CHEAPER THAN WHAT IT REPLACES. The per-enemy probing the follower did was measured by
 * removing it: 695 -> 641 us per tick at 300 enemies, so those probes cost ~54 us EVERY tick
 * against ~8 us amortised for the field.
 *
 * ---------------------------------------------------------------------------------------------
 * DERIVED STATE, SO IT IS NOT IN THE HASH
 * ---------------------------------------------------------------------------------------------
 * The field is a pure function of the terrain and the player's cell, exactly as the spatial hash
 * is a pure function of the enemy pool - and like the hash it is left out of `hashWorld`. What
 * must be deterministic is the ORDER things happen in, and it is: the BFS visits neighbours in a
 * fixed order, and the decision to rebuild reads only simulation state.
 */

import { sceneryOverlap, sceneryVersion } from '../content/scenery.js';
import type { World } from '../types.js';

/**
 * Edge of one field cell, world units. THE SAME 64 AS THE MOSSY WALL LATTICE, on purpose: on that
 * map a field cell is exactly a wall cell, so a wall is either in or out with no aliasing and no
 * doorway half-blocked by rounding. On the Scrapyard the piles do not sit on any grid, so there
 * the number is simply a resolution - and 64 u against a 45-90 u pile is fine.
 */
export const FLOW_CELL = 64;

/**
 * Window edge, in cells. 48 * 64 = 3072 u, so +-1536 u about the player.
 *
 * SIZED AGAINST `RELOCATE_RADIUS` (1000 u), not against the screen. See the header: the leash is
 * what bounds the horde, and a field that only covered the view would leave the bodies waiting
 * behind a wall off-screen with no way round - which is the pressure never arriving.
 */
export const FLOW_CELLS = 48;

/**
 * Nominal body the field is built for. Runt and grunt radii are 13-21; the field marks a cell
 * blocked if a body this size could not stand at its centre.
 *
 * ONE SIZE FOR EVERY BODY, deliberately. A per-radius field would be one search per distinct size
 * and the whole saving here is that there is exactly one search. A bruiser is a little wider than
 * this and will clip a corner the field routed it through - which the push-out then slides it off,
 * costing a moment rather than a path.
 */
const FLOW_BODY_RADIUS = 18;

/**
 * The eight directions a cell can point, as unit vectors. Diagonals are 1/sqrt(2) written out -
 * a literal, so nothing here depends on a runtime sqrt agreeing between engines.
 */
const D = 0.7071067811865476;
const DIR_X = Object.freeze([1, D, 0, -D, -1, -D, 0, D]);
const DIR_Y = Object.freeze([0, D, 1, D, 0, -D, -1, -D]);
/** Cell offsets matching DIR_X/DIR_Y. Index 1,3,5,7 are the diagonals. */
const OFF_X = Object.freeze([1, 1, 0, -1, -1, -1, 0, 1]);
const OFF_Y = Object.freeze([0, 1, 1, 1, 0, -1, -1, -1]);

export interface FlowField {
  /** Window origin, in field-cell coordinates. */
  originCx: number;
  originCy: number;
  /** 1 where a body could not stand. */
  readonly blocked: Uint8Array;
  /** Steps to the player, or -1 for unreachable and for cells the flood never got to. */
  readonly dist: Int32Array;
  /** Index into DIR_X/DIR_Y of the BEST descent, or -1 where there is nothing to point at. */
  readonly dir: Int8Array;
  /**
   * EVERY valid descent from this cell, as a bitmask over DIR_X/DIR_Y.
   *
   * This is what route variation is made of, and it costs one byte per cell because the search had
   * already worked it out and was throwing it away. A neighbour qualifies if its distance is
   * strictly LOWER, which is exactly the condition that makes following it safe: distance falls by
   * at least one every step, so any walk down any of these bits reaches the player in at most
   * `dist` moves. Measured on the real lattice, 87.9% of reachable cells have two or more bits set
   * and 86.2% have three - so the choice was always there.
   */
  readonly options: Uint8Array;
  /** BFS scratch, allocated once. */
  readonly queue: Int32Array;
  /** Rebuild bookkeeping. `builtTick` of -1 means "never built". */
  builtTick: number;
  builtCx: number;
  builtCy: number;
  /** `sceneryVersion` as of the last build. A change here means the terrain moved under us. */
  builtVersion: number;
  /** How many rebuilds this run. Diagnostics and the harness; nothing branches on it. */
  rebuilds: number;
}

export function createFlowField(): FlowField {
  const n = FLOW_CELLS * FLOW_CELLS;
  return {
    originCx: 0,
    originCy: 0,
    blocked: new Uint8Array(n),
    dist: new Int32Array(n),
    dir: new Int8Array(n),
    options: new Uint8Array(n),
    queue: new Int32Array(n),
    builtTick: -1,
    builtCx: 0,
    builtCy: 0,
    builtVersion: -1,
    rebuilds: 0,
  };
}

/** Field-cell index for a world coordinate, on either axis. */
export function flowCellOf(v: number): number {
  return Math.floor(v / FLOW_CELL);
}

/**
 * Rebuilds the field if what it was built from has changed. Called once a tick, between player
 * movement (S3) and the horde's steering (S4), so the goal is where the player is THIS tick.
 *
 * ---------------------------------------------------------------------------------------------
 * TWO TRIGGERS, AND BOTH ARE EXACT
 * ---------------------------------------------------------------------------------------------
 * The field is a pure function of two things - where the player is standing, and what the terrain
 * looks like - so it needs rebuilding exactly when one of those changes, and never otherwise.
 *
 * IT USED TO EXPIRE ON A TIMER INSTEAD, every half second, because there was no way to ask the
 * terrain whether it had moved. That was wrong in both directions at once: standing in an empty
 * field where nothing had changed it rebuilt 120 times a minute for nothing, and when a tree DID
 * come down it took up to half a second to notice - which is precisely the moment a route opens
 * and the horde ought to pour through it. `sceneryVersion` replaced the timer with the actual
 * question, so the wasted rebuilds are gone and the felled tree is seen on the very next tick.
 *
 * Both triggers read only simulation state, so two runs of the same seed rebuild on the same ticks.
 */
export function updateFlowField(world: World): void {
  const f = world.flow;
  const cx = flowCellOf(world.player.x);
  const cy = flowCellOf(world.player.y);
  const version = sceneryVersion(world.scenery);
  if (f.builtTick >= 0 && cx === f.builtCx && cy === f.builtCy && version === f.builtVersion) {
    return;
  }

  const N = FLOW_CELLS;
  const half = N >> 1;
  f.originCx = cx - half;
  f.originCy = cy - half;
  f.builtCx = cx;
  f.builtCy = cy;
  f.builtVersion = version;
  f.builtTick = world.tick;
  f.rebuilds++;

  const blocked = f.blocked;
  const dist = f.dist;
  const dir = f.dir;
  const options = f.options;
  const queue = f.queue;
  const scenery = world.scenery;

  // ---- 1. THE COST FIELD. The only place the terrain is touched, and where nearly all the time
  // goes - the flood over it afterwards is a fifth of the cost.
  for (let ry = 0; ry < N; ry++) {
    const wy = (f.originCy + ry + 0.5) * FLOW_CELL;
    const row = ry * N;
    for (let rx = 0; rx < N; rx++) {
      const wx = (f.originCx + rx + 0.5) * FLOW_CELL;
      blocked[row + rx] = sceneryOverlap(scenery, wx, wy, FLOW_BODY_RADIUS) >= 0 ? 1 : 0;
    }
  }

  // ---- 2. THE INTEGRATION FIELD: breadth-first out from the player's own cell.
  //
  // FOUR-WAY, not eight. A body may move diagonally - the direction pass below emits diagonals -
  // but the DISTANCES must not, because an eight-way flood makes a diagonal step as cheap as an
  // orthogonal one and the field then prefers staircases that hug corners. Four-way distances with
  // an eight-way descent is the standard pairing and it is what HowToRTS and Red Blob both use.
  dist.fill(-1);
  let head = 0;
  let tail = 0;
  const goal = half * N + half;
  // The player standing inside terrain would otherwise seed nothing and leave the whole field
  // unreachable, which reads as the horde giving up. Seed it regardless; the flood still spreads.
  dist[goal] = 0;
  queue[tail++] = goal;
  while (head < tail) {
    const i = queue[head++];
    const iy = (i / N) | 0;
    const ix = i - iy * N;
    const d = dist[i] + 1;
    if (ix > 0) {
      const j = i - 1;
      if (dist[j] < 0 && blocked[j] === 0) {
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    if (ix < N - 1) {
      const j = i + 1;
      if (dist[j] < 0 && blocked[j] === 0) {
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    if (iy > 0) {
      const j = i - N;
      if (dist[j] < 0 && blocked[j] === 0) {
        dist[j] = d;
        queue[tail++] = j;
      }
    }
    if (iy < N - 1) {
      const j = i + N;
      if (dist[j] < 0 && blocked[j] === 0) {
        dist[j] = d;
        queue[tail++] = j;
      }
    }
  }

  // ---- 3. THE FLOW FIELD: each reachable cell points at whichever of its eight neighbours is
  // nearest the player.
  //
  // Done ONCE PER REBUILD rather than per enemy per tick, which is the right way round: a rebuild
  // happens about three times a second and there are three hundred bodies reading it sixty times.
  //
  // A DIAGONAL IS REFUSED UNLESS BOTH ITS ORTHOGONALS ARE OPEN. Without that test a body cuts the
  // corner between two walls that meet at a point - the field says the diagonal is nearer, and it
  // is, but the body cannot fit through the join and grinds on it instead.
  for (let i = 0; i < N * N; i++) {
    if (dist[i] < 0) {
      dir[i] = -1;
      options[i] = 0;
      continue;
    }
    const iy = (i / N) | 0;
    const ix = i - iy * N;
    const here = dist[i];
    let best = -1;
    let bestD = here;
    let mask = 0;
    for (let k = 0; k < 8; k++) {
      const nx = ix + OFF_X[k];
      const ny = iy + OFF_Y[k];
      if (nx < 0 || nx >= N || ny < 0 || ny >= N) continue;
      const j = ny * N + nx;
      const nd = dist[j];
      if (nd < 0 || nd >= here) continue;
      if ((k & 1) === 1) {
        // Diagonal: both shoulders must be open.
        if (blocked[iy * N + nx] !== 0 || blocked[ny * N + ix] !== 0) continue;
      }
      // EVERY strictly-lower neighbour is a valid route, not just the lowest. The mask keeps all
      // of them; `dir` keeps the best, which is what a body with no preference gets.
      mask |= 1 << k;
      if (nd < bestD) {
        bestD = nd;
        best = k;
      }
    }
    dir[i] = best;
    options[i] = mask;
  }
}

/** Where to walk, written by `flowSteer`. Module scratch: `seek` allocates nothing. */
export let FLOW_X = 0;
export let FLOW_Y = 0;

/**
 * Where the body at (x, y) should walk, written into FLOW_X/FLOW_Y. False when the field has
 * nothing to say - outside the window, inside terrain, or in a pocket the flood never reached -
 * and the caller falls back to its own steering.
 *
 * ---------------------------------------------------------------------------------------------
 * THE CALLER DECIDES WHEN TO ASK, AND THAT TEST MUST BE LOCAL
 * ---------------------------------------------------------------------------------------------
 * It is tempting to have the field decide for itself whether a body needs it - compare the flood
 * distance against the straight-line distance, and only detour when the route is longer. That was
 * tried and it is WRONG, for a reason worth writing down because it looks correct:
 *
 *   THE FLOOD IS FOUR-WAY, so `dist == manhattan` means SOME monotone staircase to the player
 *   exists. It does not mean the STRAIGHT LINE is clear. Standing at the western end of a wall you
 *   can reach the player in Manhattan steps by going south first and then east - while the direct
 *   line still runs through the wall.
 *
 * The two then disagree across a cell boundary: one cell says "walk straight" (east, into the
 * wall) and its neighbour says "detour" (west, round it), and a body straddling the boundary
 * alternates between them forever. Measured - a body sat at the corner of an eight-cell wall for
 * a whole run, flipping east/west every few ticks, and 0 of 12 got round.
 *
 * So the trigger stays where it can see the truth: a short probe in front of the body, in `seek`.
 * When something is actually there, the field says where to go instead. The probe and the field
 * agree about the local facts, so there is nothing for them to oscillate between.
 */
export function flowDirAt(f: FlowField, x: number, y: number): boolean {
  if (f.builtTick < 0) return false;
  const rx = flowCellOf(x) - f.originCx;
  const ry = flowCellOf(y) - f.originCy;
  if (rx < 0 || rx >= FLOW_CELLS || ry < 0 || ry >= FLOW_CELLS) return false;
  const k = f.dir[ry * FLOW_CELLS + rx];
  if (k < 0) return false;
  FLOW_X = DIR_X[k];
  FLOW_Y = DIR_Y[k];
  return true;
}

/**
 * HOW EACH BODY LIKES TO COME AT YOU: four fixed rotations of the bearing to the player, as
 * cos/sin pairs.
 *
 * A body picks whichever valid descent best matches ITS bearing rather than the shortest one, so a
 * pack that used to file through a gap one behind another now arrives spread across the whole band
 * of routes that work. Two of the four lean each way, so the horde splits rather than drifting.
 *
 * +-40 and +-14 degrees. Wider than 40 and a body spends so long going sideways that it reads as
 * confused rather than as flanking; tighter than 14 and it is the same route as everybody else.
 * Written as literals - the rotation is two multiplies and there is no trigonometry at runtime to
 * disagree between V8 in CI and JSC on the phone.
 */
const SWIRL_COS = Object.freeze([
  0.766044443118978, 0.9702957262759965, 0.9702957262759965, 0.766044443118978,
]);
const SWIRL_SIN = Object.freeze([
  -0.6427876096865393, -0.24192189559966773, 0.24192189559966773, 0.6427876096865393,
]);

/**
 * The direction THIS body should take out of its cell, given where it wants to go and who it is.
 *
 * ---------------------------------------------------------------------------------------------
 * WHY EVERY CHOICE HERE IS SAFE
 * ---------------------------------------------------------------------------------------------
 * It picks from `options`, and every bit in that mask is a neighbour whose distance to the player
 * is STRICTLY LOWER. So whichever one a body takes, its distance falls by at least one cell per
 * step and it arrives in at most `dist` moves. There is no route in here that can loop, dead-end
 * or wander - the variation is over paths that all work, which is the whole point.
 *
 * THE COST OF THE SCENIC ROUTE IS BOUNDED, and worth stating because "any descending neighbour"
 * sounds looser than it is. The best step drops the distance by 2 (a diagonal) and the worst by 1,
 * so a body that takes the scenic option every single time walks at most twice the cells of one
 * that never does. In practice it is far less, because the preferred bearing keeps pulling back
 * toward the player.
 *
 * `id` is the body's `spawnId`: stable for its whole life, so its choice does not flicker tick to
 * tick, and consecutive spawns get different leanings so a wave fans out instead of forming a line.
 */
export function flowDirFor(
  f: FlowField,
  x: number,
  y: number,
  ux: number,
  uy: number,
  id: number,
): boolean {
  if (f.builtTick < 0) return false;
  const rx = flowCellOf(x) - f.originCx;
  const ry = flowCellOf(y) - f.originCy;
  if (rx < 0 || rx >= FLOW_CELLS || ry < 0 || ry >= FLOW_CELLS) return false;
  const mask = f.options[ry * FLOW_CELLS + rx];
  if (mask === 0) return false;

  // The bearing this body would like to be travelling on: straight at the player, turned by its
  // own fixed lean.
  const s = id & 3;
  const c = SWIRL_COS[s];
  const sn = SWIRL_SIN[s];
  const wx = ux * c - uy * sn;
  const wy = ux * sn + uy * c;

  let best = -1;
  let bestDot = -Infinity;
  for (let k = 0; k < 8; k++) {
    if ((mask & (1 << k)) === 0) continue;
    const dot = DIR_X[k] * wx + DIR_Y[k] * wy;
    // Strictly greater, so ties fall to the lowest k and the result cannot depend on iteration
    // order changing under us.
    if (dot > bestDot) {
      bestDot = dot;
      best = k;
    }
  }
  if (best < 0) return false;
  FLOW_X = DIR_X[best];
  FLOW_Y = DIR_Y[best];
  return true;
}
