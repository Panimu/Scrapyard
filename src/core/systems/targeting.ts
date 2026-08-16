/**
 * TARGET SELECTION - the pluggable strategies behind `WeaponDef.targeting`.
 *
 * THE SPECCED RULE (DESIGN.md §7.2), which this file exists to implement exactly:
 *
 *   > The Cannon fires at the enemy with the HIGHEST CURRENT HP within range. Not the nearest.
 *
 * Over the set S of enemies e with dist2(origin, e) <= range^2 and (flags & DEAD) === 0, select
 * the argmax under this STRICT TOTAL order, compared in sequence:
 *
 *   1. hp[e]                 - CURRENT hp, not max          higher wins   (the distinctive rule)
 *   2. dist2(origin, e)      -                              lower wins    (nearest)
 *   3. spawnId[e]            -                              lower wins    (oldest surviving)
 *
 * If S is empty the weapon does not fire and its cooldown is not consumed (see weapons.ts).
 *
 * Three points that are contract, not commentary:
 *
 *   - "ENTITY ID" MEANS `spawnId`, NOT slot and not handle. Slots are recycled by the free list,
 *     so a slot-based tie-break would make targeting depend on the pool's kill history:
 *     deterministic, but semantically arbitrary and horrible to write a test against. spawnId is
 *     monotonic and unique, so key 3 can never tie and the order is TOTAL - which is precisely
 *     what makes the result independent of the order the spatial hash happens to visit
 *     candidates in.
 *
 *   - THE DEAD-FLAG CHECK IS MANDATORY. With deferred reaping an enemy killed earlier this tick
 *     is still in the pool and still in the hash until S12. Skipping it is what stops the Cannon
 *     burning a 1.2 s cooldown on a corpse.
 *
 *   - QUERY THE SPATIAL HASH; NEVER SCAN THE POOL. At one shot per 1.2 s a 300-enemy linear scan
 *     would be fine today. It is not written that way because weapons #2-#12 are coming, target
 *     selection runs EVERY TICK (not only when the cooldown is ready), and a 6-weapon loadout at
 *     reduced cooldowns turns "fine" into 100 000+ distance tests per second on a phone GPU's
 *     CPU budget.
 */

import { sceneryRayHit } from '../content/scenery.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import type { EnemyPool } from '../entity/enemyPool.js';
import type { World } from '../types.js';
import type { TargetingFn, TargetingId } from '../content/weaponCatalog.js';

/**
 * Collects the DENSE indices of every live enemy strictly inside the range circle, compacted in
 * place into `out`, and returns the count.
 *
 * `queryCircleLiveInto` walks whole cells, so its result is a SUPERSET of the circle; the exact
 * squared-distance re-check below is what turns it into the real set S. Doing the compaction
 * here rather than inside each strategy means the (expensive) hash walk and the (exact) range
 * test are written once, while each strategy keeps its own tight, monomorphic compare loop.
 *
 * The query radius is `sqrt(rangeSq)` because TargetingFn is handed the squared range - the form
 * every caller actually compares against. sqrt is exactly rounded, and for the shipping numbers
 * it is exact (260^2 = 67600 is an integer, sqrt(67600) = 260). Even a 1-ulp shortfall could
 * only ever matter for an enemy sitting exactly on the range boundary AND exactly on the nearest
 * corner of its cell, and would still be deterministic; the authoritative test is `<= rangeSq`.
 */
export function gatherLiveInRange(
  world: World,
  originX: number,
  originY: number,
  rangeSq: number,
  out: Uint16Array,
): number {
  const enemies = world.enemies;
  const n = queryCircleLiveInto(
    world.spatial,
    enemies,
    originX,
    originY,
    Math.sqrt(rangeSq),
    out,
  );

  const ex = enemies.x;
  const ey = enemies.y;
  const er = enemies.radius;
  const scenery = world.scenery;
  let m = 0;
  for (let i = 0; i < n; i++) {
    const d = out[i];
    const dx = ex[d] - originX;
    const dy = ey[d] - originY;
    const d2 = dx * dx + dy * dy;
    if (d2 > rangeSq) continue;

    // ---------------------------------------------------------------------------------------
    // LINE OF SIGHT. A body you cannot shoot is not a target.
    // ---------------------------------------------------------------------------------------
    // Every gun in this game fires in a straight line at what it picked, and everything that
    // stops a round - a wreck, a rock wall - stops it before it arrives. So a target behind cover
    // is not a hard shot, it is a shot that CANNOT LAND, and choosing one is strictly worse than
    // choosing anything else in range:
    //
    //   the shell buries itself in the obstruction and the cooldown is spent anyway;
    //   the LASERS are worse still - they refuse the shot when something is in the way (see
    //     fireBeam), so a laser that has locked onto an occluded body simply stops firing and
    //     sits idle with a full heat bar while things it CAN see walk past it.
    //
    // Filtering here rather than at the trigger is what fixes the second case: the weapon has to
    // pick a different body, and it can only do that if the occluded one was never a candidate.
    //
    // MEASURED TO THE BODY'S NEAR EDGE, not its centre - `d2` is the centre distance and the ray
    // is cut short by the enemy's own radius. Otherwise a body pressed against the far side of a
    // wall would occlude ITSELF: the wall it is touching sits between the origin and its centre.
    //
    // COST: one ray per in-range body per weapon per tick, and the ray stops at the first thing it
    // meets. On the Scrapyard the piles are round and sparse, so this almost always terminates
    // immediately; on Mossy it is a grid walk of a handful of cells.
    if (d2 > 0) {
      const dist = Math.sqrt(d2);
      const reach = dist - er[d];
      if (reach > 0 && sceneryRayHit(scenery, originX, originY, dx / dist, dy / dist, reach) >= 0) {
        continue;
      }
    }

    // m <= i always, so compacting in place can never clobber an unread entry.
    out[m++] = d;
  }
  return m;
}

/**
 * The Cannon's order: higher hp, then nearer, then lower spawnId. Strict and total.
 *
 * Exported because it IS the rule - a test that asserts the ordering directly is worth more than
 * one that infers it from which enemy happened to get shot.
 */
export function betterHighestHp(
  e: EnemyPool,
  a: number,
  b: number,
  originX: number,
  originY: number,
): boolean {
  const ha = e.hp[a];
  const hb = e.hp[b];
  if (ha !== hb) return ha > hb;

  const ax = e.x[a] - originX;
  const ay = e.y[a] - originY;
  const bx = e.x[b] - originX;
  const by = e.y[b] - originY;
  const da = ax * ax + ay * ay;
  const db = bx * bx + by * by;
  if (da !== db) return da < db;

  return e.spawnId[a] < e.spawnId[b];
}

/**
 * The mirror order: nearer, then higher hp, then lower spawnId.
 *
 * Keys 2 and 3 are not arbitrary - without them this would not be a total order and the result
 * would depend on hash visit order, which is exactly the class of bug that makes a replay drift.
 */
export function betterNearest(
  e: EnemyPool,
  a: number,
  b: number,
  originX: number,
  originY: number,
): boolean {
  const ax = e.x[a] - originX;
  const ay = e.y[a] - originY;
  const bx = e.x[b] - originX;
  const by = e.y[b] - originY;
  const da = ax * ax + ay * ay;
  const db = bx * bx + by * by;
  if (da !== db) return da < db;

  const ha = e.hp[a];
  const hb = e.hp[b];
  if (ha !== hb) return ha > hb;

  return e.spawnId[a] < e.spawnId[b];
}

/**
 * The lasers' order: LOWER hp, then nearer, then lower spawnId.
 *
 * The exact mirror of `betterHighestHp` in key 1 and identical in keys 2 and 3, which is the
 * point: the Cannon and a laser standing in the same crowd pick OPPOSITE ends of the same
 * ordering, so a loadout carrying both is genuinely covering two problems rather than
 * double-tapping one.
 *
 * Keys 2 and 3 are not decoration. Runts spawn at identical hp by the dozen, so key 1 ties
 * constantly - far more often than it does for the Cannon, where the interesting target is
 * usually the unique big one. Without a total order the beam would flicker between equal-hp
 * enemies in spatial-hash visit order, which is deterministic but arbitrary, would make the
 * drawn line jitter, and would put a replay at the mercy of the hash's bucket layout.
 */
export function betterLowestHp(
  e: EnemyPool,
  a: number,
  b: number,
  originX: number,
  originY: number,
): boolean {
  const ha = e.hp[a];
  const hb = e.hp[b];
  if (ha !== hb) return ha < hb;

  const ax = e.x[a] - originX;
  const ay = e.y[a] - originY;
  const bx = e.x[b] - originX;
  const by = e.y[b] - originY;
  const da = ax * ax + ay * ay;
  const db = bx * bx + by * by;
  if (da !== db) return da < db;

  return e.spawnId[a] < e.spawnId[b];
}

type BetterFn = (e: EnemyPool, a: number, b: number, originX: number, originY: number) => boolean;

/**
 * Top-K insertion sort over the candidate set. Allocation-free, and O(n) in the common case
 * because a candidate that cannot beat the current worst is rejected by ONE comparison.
 *
 * K is at most MAX_TARGETS (8) and is 1 for every weapon in this iteration, so the insertion
 * shift is at most 7 typed-array moves on the rare occasions it runs at all. A heap would be
 * strictly worse here: more branches, worse locality, and a comparator that has to be a function
 * pointer anyway.
 *
 * DUPLICATE CANDIDATES: `queryCircleLiveInto` documents its result as a superset that MAY contain
 * duplicates (bucket aliasing). For a K = 1 argmax that is harmless - it just evaluates twice -
 * but for K > 1 a duplicate would put one enemy in two target slots and silently turn a battery
 * into a focus-fire weapon. The explicit membership check below costs at most K integer compares
 * per ACCEPTED candidate and makes this function correct against the documented contract rather
 * than against the current implementation.
 */
function selectTopK(
  world: World,
  originX: number,
  originY: number,
  rangeSq: number,
  wantCount: number,
  out: Int32Array,
  better: BetterFn,
): number {
  const k = wantCount < out.length ? wantCount : out.length;
  if (k <= 0) return 0;

  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const n = gatherLiveInRange(world, originX, originY, rangeSq, candidates);
  if (n === 0) return 0;

  let count = 0;
  for (let i = 0; i < n; i++) {
    const d = candidates[i];

    // Fast reject: full list and not better than the worst kept.
    if (count === k && !better(enemies, d, out[count - 1], originX, originY)) continue;

    let duplicate = false;
    for (let j = 0; j < count; j++) {
      if (out[j] === d) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;

    // Insert. When the list is full this starts at k-1, which drops the current worst.
    let pos = count < k ? count : k - 1;
    while (pos > 0 && better(enemies, d, out[pos - 1], originX, originY)) {
      out[pos] = out[pos - 1];
      pos--;
    }
    out[pos] = d;
    if (count < k) count++;
  }
  return count;
}

/** The Cannon's rule. See the file header for the full order. */
export const targetHighestHp: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
): number => selectTopK(world, originX, originY, rangeSq, wantCount, out, betterHighestHp);

/** Classic survivors-genre targeting. Used by SCATTER's trait for shells 2..n. */
export const targetNearest: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
): number => selectTopK(world, originX, originY, rangeSq, wantCount, out, betterNearest);

/**
 * The lasers' rule: the WEAKEST thing in range. See `betterLowestHp` for the full order.
 *
 * It is the exact complement of the Cannon's rule. The Cannon commits to the single biggest
 * threat and, with no splash of its own, leaves every other body untouched; the lasers sweep the
 * weakest and burn whatever is standing in the way. Between them the field gets cleared from both
 * ends, and neither weapon does the other's job.
 */
export const targetLowestHp: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
): number => selectTopK(world, originX, originY, rangeSq, wantCount, out, betterLowestHp);

/**
 * THE STRATEGY TABLE. Adding a targeting rule is one entry here plus one pure function above -
 * `updateWeapons` never learns the rule exists.
 */
export const TARGETING: Readonly<Record<TargetingId, TargetingFn>> = Object.freeze({
  'highest-hp': targetHighestHp,
  nearest: targetNearest,
  'lowest-hp': targetLowestHp,
});
