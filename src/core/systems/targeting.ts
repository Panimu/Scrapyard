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
import { PHASE_CLUSTER_RADIUS, type TargetingFn, type TargetingId } from '../content/weaponCatalog.js';

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
 * THE PHASE CANNON'S RULE: the body with the most live neighbours within PHASE_CLUSTER_RADIUS of
 * it, then nearest to the origin, then lowest spawnId. Strict and total, like the other three.
 *
 * TWO DELIBERATE DEPARTURES from the shared machinery:
 *
 * NO LINE-OF-SIGHT FILTER. Every other rule goes through `gatherLiveInRange`, which drops a body
 * the weapon cannot draw a clear line to - because for every other weapon an occluded target is a
 * wasted cooldown. The phase bolt flies through scrap, walls and bodies alike, so occlusion is
 * not a fact about ITS shots, and filtering would blind the one gun whose whole identity is
 * shooting the knot of enemies behind cover. Hence the bespoke gather below: range test and
 * dedupe, no ray.
 *
 * DEDUPED BEFORE COUNTING. `queryCircleLiveInto` may return a body twice (bucket aliasing); for
 * the argmax rules a duplicate is harmless, but here it would double-count every neighbour tally
 * involving it. The dedupe is the membership scan `selectTopK` already does at insert, moved to
 * gather time.
 *
 * COST, bounded and stated: the tally is one pass over all candidate PAIRS - O(n^2) with n the
 * live bodies in the range circle. Bodies have real radii and separation keeps them apart, so a
 * 260 u circle physically holds ~150 of the smallest; 150^2/2 pairs of four float ops each is
 * ~45k ops per tick worst case, on flat typed arrays. Measured against the budget targeting.ts
 * frets about, that is well under the 100k/s line that motivated the spatial hash - and typical
 * fields are a tenth of the worst case.
 */
/**
 * Gather: live, in range, deduped, into `world.scratch.candidates`. NO line-of-sight ray - see
 * the header.
 *
 * SHARED BY THE TWO CLUSTER RULES rather than written twice. It was inline in `targetDensest`
 * until the Mortar needed the same set to filter a cone out of, and two copies of a dedupe that
 * feeds a determinism-critical argmax is two places for the corpus to start disagreeing with
 * itself.
 */
function gatherInRange(
  world: World,
  originX: number,
  originY: number,
  rangeSq: number,
): number {
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const raw = queryCircleLiveInto(
    world.spatial,
    enemies,
    originX,
    originY,
    Math.sqrt(rangeSq),
    candidates,
  );
  const ex = enemies.x;
  const ey = enemies.y;
  let n = 0;
  for (let i = 0; i < raw; i++) {
    const d = candidates[i];
    const dx = ex[d] - originX;
    const dy = ey[d] - originY;
    if (dx * dx + dy * dy > rangeSq) continue;
    let duplicate = false;
    for (let j = 0; j < n; j++) {
      if (candidates[j] === d) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) continue;
    candidates[n++] = d;
  }
  return n;
}

/**
 * Score `n` already-gathered candidates by how crowded each one is, and take the top `k`.
 *
 * EXTRACTED VERBATIM from `targetDensest`, and the corpus is what says so: this arithmetic
 * decides which body a Phase Cannon bolt lands on, so a refactor of it that changed one comparison
 * would move nine recorded runs. It did not.
 */
function scoreDensest(
  world: World,
  originX: number,
  originY: number,
  n: number,
  k: number,
  out: Int32Array,
): number {
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const counts = world.scratch.neighbourCounts;
  const ex = enemies.x;
  const ey = enemies.y;

  // Tally neighbours among the candidates themselves, each pair once. A body's own cluster can
  // extend past the weapon's range; those outliers are not counted, which is the honest reading -
  // this rule scores what the weapon can actually see and the blast can actually follow up on.
  const r2 = PHASE_CLUSTER_RADIUS * PHASE_CLUSTER_RADIUS;
  for (let i = 0; i < n; i++) counts[i] = 0;
  for (let i = 0; i < n; i++) {
    const a = candidates[i];
    const axv = ex[a];
    const ayv = ey[a];
    for (let j = i + 1; j < n; j++) {
      const b = candidates[j];
      const dx = ex[b] - axv;
      const dy = ey[b] - ayv;
      if (dx * dx + dy * dy <= r2) {
        counts[i]++;
        counts[j]++;
      }
    }
  }

  // Argmax by (count desc, dist2 asc, spawnId asc) - strict and total, so the result cannot
  // depend on hash visit order. K is 1 for the one weapon that uses this; wantCount is honoured
  // by re-scanning with an already-taken check, which at K <= MAX_TARGETS beats sorting n.
  let filled = 0;
  while (filled < k) {
    let best = -1;
    let bestIdx = -1;
    for (let i = 0; i < n; i++) {
      const d = candidates[i];
      let taken = false;
      for (let j = 0; j < filled; j++) {
        if (out[j] === d) {
          taken = true;
          break;
        }
      }
      if (taken) continue;
      if (best >= 0) {
        const cb = counts[bestIdx];
        const ci = counts[i];
        if (ci < cb) continue;
        if (ci === cb) {
          const bx = ex[best] - originX;
          const by = ey[best] - originY;
          const ix = ex[d] - originX;
          const iy = ey[d] - originY;
          const db = bx * bx + by * by;
          const di = ix * ix + iy * iy;
          if (di > db) continue;
          if (di === db && enemies.spawnId[d] >= enemies.spawnId[best]) continue;
        }
      }
      best = d;
      bestIdx = i;
    }
    if (best < 0) break;
    out[filled++] = best;
  }
  return filled;
}

/**
 * THE THICKEST KNOT IN RANGE, wherever it is. The Phase Cannon's rule.
 */
export const targetDensest: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
): number => {
  const k = wantCount < out.length ? wantCount : out.length;
  if (k <= 0) return 0;

  const n = gatherInRange(world, originX, originY, rangeSq);
  if (n === 0) return 0;
  return scoreDensest(world, originX, originY, n, k, out);
};

/**
 * THE COSINES OF THE CONE THIS RULE WIDENS THROUGH, in fifteen-degree steps out to a full circle.
 *
 * A COSINE TABLE AND NOT A TRIG CALL, because core may not have one: `Math.cos` is
 * implementation-approximated and a target chosen by an ULP is a different run on somebody else's
 * machine. `dot(d, aim) >= cos(t) * |d|` is the same test with the transcendental hoisted out to
 * a literal, and a literal is the same double in both languages by construction.
 *
 * THE LAST ENTRY IS EXACTLY -1, which accepts everything: `dot >= -|d|` cannot be false. That is
 * what guarantees the widening loop terminates with a target whenever anything is in range at
 * all, rather than falling off the end of the table having found nothing.
 */
const CONE_COS: readonly number[] = Object.freeze([
  0.9659258262890683, // 15 degrees
  0.8660254037844387, // 30
  0.7071067811865476, // 45
  0.5, // 60
  0.25881904510252074, // 75
  0, // 90
  -0.25881904510252074, // 105
  -0.5, // 120
  -0.7071067811865476, // 135
  -0.8660254037844387, // 150
  -0.9659258262890683, // 165
  -1, // 180 - the whole field
]);

/**
 * THE THICKEST KNOT INSIDE A CONE IN FRONT OF THE BARREL, widening until it finds one.
 *
 * The Mortar's rule, and the reason `TargetingFn` carries the turret's facing at all. It is the
 * densest rule with a filter in front of it: look in a narrow cone first, and only if nothing is
 * there open the cone by another fifteen degrees and look again.
 *
 * THAT IS THE WEAPON'S CHARACTER AND NOT A COST. A gun that prefers what is already in front of
 * its barrel shoots without slewing, keeps shooting while the crowd it is working stays put, and
 * swings across the yard only when the front has nothing left to offer - so where the mech is
 * pointing is a decision the player makes with the whole machine.
 *
 * THE WIDENING IS ALL-OR-NOTHING PER STEP, not a preference. The first cone with anything in it
 * wins outright, and the densest knot INSIDE it is chosen - a bigger crowd one degree outside the
 * cone does not pull the shot. Scoring across the whole field with a distance-from-aim penalty
 * was the alternative and it is a different weapon: it would always shoot the biggest crowd and
 * merely lean toward the front.
 */
export const targetConeDensest: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
  aimX,
  aimY,
): number => {
  const k = wantCount < out.length ? wantCount : out.length;
  if (k <= 0) return 0;

  const n = gatherInRange(world, originX, originY, rangeSq);
  if (n === 0) return 0;

  // NORMALISED HERE rather than trusted. The turret's facing is a unit vector everywhere it is
  // maintained, and this rule is wrong in a way nobody would see - a slightly long aim vector
  // silently narrows every cone - if it ever stops being one.
  const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);
  if (aimLen <= 0) return scoreDensest(world, originX, originY, n, k, out);
  const ax = aimX / aimLen;
  const ay = aimY / aimLen;

  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const ex = enemies.x;
  const ey = enemies.y;

  for (let step = 0; step < CONE_COS.length; step++) {
    const minCos = CONE_COS[step];
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const d = candidates[i];
      const dx = ex[d] - originX;
      const dy = ey[d] - originY;
      // dot >= cos(t) * |d|, which is "the angle between them is at most t" without an acos.
      // Compared against the LENGTH rather than the square so the sign of the dot still means
      // what it should past ninety degrees.
      const len = Math.sqrt(dx * dx + dy * dy);
      if (dx * ax + dy * ay >= minCos * len) {
        // Compacted in place. `candidates` is scratch and the order of what survives is the order
        // it arrived in, so the argmax below still breaks ties the same way it always did.
        candidates[kept++] = d;
      }
    }

    if (kept > 0) return scoreDensest(world, originX, originY, kept, k, out);

    // NOTHING SURVIVED, so the next cone has to start from the full set again - the compaction
    // above has already overwritten the front of the buffer with a shorter list.
    const refill = gatherInRange(world, originX, originY, rangeSq);
    if (refill === 0) return 0;
  }

  return 0;
};

/**
 * Take the top `k` of `n` already-gathered candidates by the highest-HP order.
 *
 * THE SAME COMPARATOR THE CANNON USES (`betterHighestHp`: hp desc, then nearest, then lowest
 * spawnId - strict and total), applied to a list somebody else filtered. `selectTopK` cannot be
 * reused here because it gathers its own candidates, and the whole point of the cone rules is
 * that the gather has already happened and been cut down.
 */
function scoreHighestHp(
  world: World,
  originX: number,
  originY: number,
  n: number,
  k: number,
  out: Int32Array,
): number {
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;

  let filled = 0;
  while (filled < k) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      const d = candidates[i];
      let taken = false;
      for (let j = 0; j < filled; j++) {
        if (out[j] === d) {
          taken = true;
          break;
        }
      }
      if (taken) continue;
      if (best < 0 || betterHighestHp(enemies, d, best, originX, originY)) best = d;
    }
    if (best < 0) break;
    out[filled++] = best;
  }
  return filled;
}

/**
 * THE PLASMA THROWER'S RULE: the biggest thing in front of the barrel that is NOT already alight,
 * widening the cone by thirty degrees at a time until it finds one.
 *
 * IT IS THE MORTAR'S WIDENING LOOP WITH A DIFFERENT PREDICATE AND A DIFFERENT SCORE, which is
 * exactly what the strategy table is for. Two departures from `cone-densest`, and both are the
 * weapon:
 *
 * THIRTY DEGREES PER STEP, NOT FIFTEEN. The Mortar is choosing where one heavy shell lands and a
 * narrow first look is what makes it obedient to the chassis. This gun fires four bolts a second
 * and wants to be walking down the crowd, so a wider first look keeps it working the front
 * instead of stepping through six cones every time the nearest body dies.
 *
 * ALREADY BURNING IS SKIPPED, and that is the whole reason this rule exists. `ignite` refreshes
 * rather than stacks, so a second bolt into a burning bruiser is worth almost nothing; a gun that
 * kept picking the biggest body would spend an entire fight re-lighting one enemy. Skipping what
 * is alight makes it spread fire down the crowd on its own, which is what the player is buying.
 *
 * WHEN EVERYTHING IS ALIGHT IT SHOOTS THE BIGGEST ANYWAY, rather than holding fire. Falling
 * silent would be strictly worse - the bolt still does its damage, and a fire about to expire
 * gets refreshed. That fallback ignores the cone entirely: at that point the rule has already
 * searched the whole field for a cold body and found none, so re-narrowing to thirty degrees
 * would be pretending it had not.
 */
export const targetConeColdest: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
  aimX,
  aimY,
): number => {
  const k = wantCount < out.length ? wantCount : out.length;
  if (k <= 0) return 0;

  const n = gatherInRange(world, originX, originY, rangeSq);
  if (n === 0) return 0;

  // Normalised here rather than trusted, for the reason `targetConeDensest` gives.
  const aimLen = Math.sqrt(aimX * aimX + aimY * aimY);
  if (aimLen <= 0) return scoreHighestHp(world, originX, originY, n, k, out);
  const ax = aimX / aimLen;
  const ay = aimY / aimLen;

  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const ex = enemies.x;
  const ey = enemies.y;
  const burn = enemies.burnLeft;

  // EVERY SECOND ENTRY, so the cone opens 30 / 60 / 90 ... and the last step is still exactly
  // 180 - the whole field - which is what guarantees this terminates. Indexing the shared table
  // rather than authoring a second one keeps both guns' cosines exactly-rounded literals from one
  // place; see CONE_COS.
  for (let step = 1; step < CONE_COS.length; step += 2) {
    const minCos = CONE_COS[step];
    let kept = 0;
    for (let i = 0; i < n; i++) {
      const d = candidates[i];
      if (burn[d] > 0) continue;
      const dx = ex[d] - originX;
      const dy = ey[d] - originY;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (dx * ax + dy * ay >= minCos * len) candidates[kept++] = d;
    }

    if (kept > 0) return scoreHighestHp(world, originX, originY, kept, k, out);

    const refill = gatherInRange(world, originX, originY, rangeSq);
    if (refill === 0) return 0;
  }

  // Nothing cold anywhere in range. See the header: it shoots the biggest thing it can reach.
  return scoreHighestHp(world, originX, originY, n, k, out);
};

/**
 * TOXIC SLUDGE'S GATE: is there anything behind me worth throwing at?
 *
 * IT IS A YES/NO QUESTION WEARING A TARGETING RULE'S CLOTHES, and that is the honest description.
 * `fireSludge` never looks at what this returns - the fan leaves from the mech's back in the same
 * shape whatever is standing there. What the strategy seam buys is the ONE thing this weapon does
 * need from targeting: `requiresTarget` makes updateWeapons skip a weapon whose rule found
 * nothing, which is exactly "do not spend a third of a three-shot magazine on empty yard".
 *
 * OFF THE CHASSIS FACING, NOT THE TURRET, which is why this one rule ignores the `aimX`/`aimY` it
 * is handed. Toxic Sludge has no mount and no turret to slew; where its shot goes is decided by
 * which way the mech is walking, so the cone has to be measured against the same vector the
 * renderer draws the hull at. Reading `world.player` here rather than threading a third pair of
 * arguments through every rule keeps the seam the size it is.
 *
 * A HUNDRED AND TWENTY DEGREES, FIXED, AND IT NEVER WIDENS - the opposite of the two cone rules
 * above. Those widen because they must eventually find SOMETHING; this one must be able to answer
 * no, because "no" is the whole point of it.
 */
export const targetRearCone: TargetingFn = (
  world,
  originX,
  originY,
  rangeSq,
  wantCount,
  out,
): number => {
  const k = wantCount < out.length ? wantCount : out.length;
  if (k <= 0) return 0;

  const n = gatherInRange(world, originX, originY, rangeSq);
  if (n === 0) return 0;

  // The mech's back. `faceX/faceY` is a unit vector everywhere it is maintained; normalising it
  // again here would be the same guard the cone rules keep, and it is kept for the same reason.
  const fx = world.player.faceX;
  const fy = world.player.faceY;
  const len = Math.sqrt(fx * fx + fy * fy);
  if (len <= 0) return 0;
  const ax = -fx / len;
  const ay = -fy / len;

  const enemies = world.enemies;
  const candidates = world.scratch.candidates;
  const ex = enemies.x;
  const ey = enemies.y;
  // CONE_COS[7] is exactly cos(120 degrees) - see the table, and the note there about why these
  // are literals rather than a call to Math.cos.
  const minCos = CONE_COS[7];

  let kept = 0;
  for (let i = 0; i < n; i++) {
    const d = candidates[i];
    const dx = ex[d] - originX;
    const dy = ey[d] - originY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dx * ax + dy * ay >= minCos * dist) candidates[kept++] = d;
  }
  if (kept === 0) return 0;
  return scoreHighestHp(world, originX, originY, kept, k, out);
};

/**
 * THE STRATEGY TABLE. Adding a targeting rule is one entry here plus one pure function above -
 * `updateWeapons` never learns the rule exists.
 */
export const TARGETING: Readonly<Record<TargetingId, TargetingFn>> = Object.freeze({
  'highest-hp': targetHighestHp,
  nearest: targetNearest,
  'lowest-hp': targetLowestHp,
  densest: targetDensest,
  'cone-densest': targetConeDensest,
  'cone-coldest': targetConeColdest,
  'rear-cone': targetRearCone,
});
