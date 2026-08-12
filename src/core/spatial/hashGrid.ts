/**
 * Broad-phase spatial hash over the enemy pool.
 *
 * UNBOUNDED VIA HASHING, NOT A FIXED GRID: the camera roams an unbounded arena, and a fixed
 * array grid would need origin rebasing - a class of off-by-one that only shows up ten minutes
 * into a run, on a phone, with no debugger. Cell coordinates are hashed into a fixed number of
 * buckets instead, and aliasing is harmless because every caller re-checks exact squared
 * distance.
 *
 * REBUILD IS A COUNTING SORT: three linear passes, zero allocation, no Map. Full rebuild every
 * tick rather than incremental maintenance - at n = 300 the rebuild is ~5 us, and an
 * incremental structure would have to be corrected on every spawn, kill and swap-remove.
 *
 * CELL SIZE 64 u is reasoned from the real numbers: enemy radii are 13-34 u, the player is 26 u,
 * and ~120 live enemies inside a 560 u radius is ~2.4 enemies per occupied cell. It is a
 * constructor argument so the harness can sweep it without editing this file.
 */

import { ENEMY_FLAG_DEAD, type EnemyPool } from '../entity/enemyPool.js';

export interface SpatialHash {
  readonly cellSize: number;
  readonly invCellSize: number;
  readonly bucketCount: number;
  readonly bucketMask: number;
  /** Prefix-summed bucket boundaries; length bucketCount + 1. */
  readonly bucketStart: Int32Array;
  /** Scatter cursors during the third pass; length bucketCount. */
  readonly cursor: Int32Array;
  /** Dense enemy indices, grouped by bucket. Valid only until the next rebuild. */
  readonly items: Uint16Array;
  /**
   * Exact packed cell coordinate of each item, parallel to `items`.
   *
   * This is what makes a HASHED grid behave like a real grid: two distant cells can land in the
   * same bucket, and without this check a query would return enemies thousands of units away.
   * They would be filtered by the caller's squared-distance re-check - but splash, separation
   * and targeting would all pay for scanning them, and the "nothing beyond r + cellSize*sqrt(2)"
   * property that makes this structure testable would simply not hold.
   */
  readonly itemKey: Int32Array;
  itemCount: number;
}

export function createSpatialHash(
  cellSize: number,
  bucketCount: number,
  capacity: number,
): SpatialHash {
  return {
    cellSize,
    invCellSize: 1 / cellSize,
    bucketCount,
    bucketMask: bucketCount - 1, // bucketCount is a power of two (SPATIAL_BUCKET_COUNT)
    bucketStart: new Int32Array(bucketCount + 1),
    cursor: new Int32Array(bucketCount),
    items: new Uint16Array(capacity),
    itemKey: new Int32Array(capacity),
    itemCount: 0,
  };
}

/**
 * Packs a cell coordinate pair into one exact i32: 16 bits each.
 * Unique for |cx|, |cy| < 32768 cells = +-2 097 152 world units at cellSize 64. A player running
 * one direction for the whole 900 s run covers ~175 000 u, so this cannot collide in practice -
 * and unlike the bucket hash it is EXACT, which is the point.
 */
function packCell(cx: number, cy: number): number {
  return ((cx & 0xffff) << 16) | (cy & 0xffff);
}

/**
 * Cell coordinate -> bucket. Two odd multipliers then xor: cheap, and it decorrelates the
 * diagonal patterns that a plain `cx * P + cy` produces on a grid of moving units.
 */
function bucketOf(cx: number, cy: number, mask: number): number {
  return (Math.imul(cx, 0x05891c1b) ^ Math.imul(cy, 0x29193f5b)) & mask;
}

/** Exposed so tests can assert bucket agreement without duplicating the hash. */
export function hashCell(h: SpatialHash, cx: number, cy: number): number {
  return bucketOf(cx, cy, h.bucketMask);
}

export function cellCoord(h: SpatialHash, v: number): number {
  return Math.floor(v * h.invCellSize);
}

/**
 * Full rebuild. Dead-flagged enemies are still inserted: they are removed later this tick by
 * reapDead, and callers must check the DEAD flag anyway (an enemy killed earlier in the tick is
 * still in the pool). Inserting them keeps this a pure function of the pool's dense range.
 */
export function rebuildSpatialHash(h: SpatialHash, p: EnemyPool): void {
  const n = p.count;
  const bucketStart = h.bucketStart;
  const cursor = h.cursor;
  const items = h.items;
  const mask = h.bucketMask;
  const inv = h.invCellSize;

  bucketStart.fill(0);

  // Pass 1: count into bucketStart[b + 1].
  for (let d = 0; d < n; d++) {
    const b = bucketOf(Math.floor(p.x[d] * inv), Math.floor(p.y[d] * inv), mask);
    bucketStart[b + 1]++;
  }

  // Pass 2: prefix sum, and seed the scatter cursors.
  let acc = 0;
  for (let b = 0; b < h.bucketCount; b++) {
    cursor[b] = acc;
    acc += bucketStart[b + 1];
    bucketStart[b + 1] = acc;
  }

  // Pass 3: scatter. The cell coords are recomputed rather than cached - two floors and two
  // imuls beat a 512-entry temp array and the allocation it would need.
  const itemKey = h.itemKey;
  for (let d = 0; d < n; d++) {
    const cx = Math.floor(p.x[d] * inv);
    const cy = Math.floor(p.y[d] * inv);
    const b = bucketOf(cx, cy, mask);
    const at = cursor[b]++;
    items[at] = d;
    itemKey[at] = packCell(cx, cy);
  }

  h.itemCount = n;
}

/**
 * Writes candidate DENSE indices into `out` and returns the count.
 *
 * CANDIDATES ARE A SUPERSET of the circle: the query walks whole cells, so it overshoots the
 * circle by up to cellSize*sqrt(2) at the corners. CALLERS MUST RE-CHECK SQUARED DISTANCE, and
 * anything that APPLIES DAMAGE must also dedupe - projectiles do it via their hit ring.
 * This is stated this loudly because assuming the result is exact silently double-applies
 * damage, which looks like a balance problem rather than a bug.
 *
 * Alias suppression: the exact cell key is compared, so an enemy from a distant cell that merely
 * hashed into the same bucket is never returned. Each enemy occupies exactly one cell, so within
 * one rebuild the result also contains no duplicates.
 *
 * Overflow is truncated at `out.length`; MAX_QUERY_CANDIDATES is sized well beyond the largest
 * query the game issues (the Cannon's 260 u circle at maximum density).
 */
export function queryCircleInto(
  h: SpatialHash,
  x: number,
  y: number,
  r: number,
  out: Uint16Array,
): number {
  const inv = h.invCellSize;
  const cx0 = Math.floor((x - r) * inv);
  const cx1 = Math.floor((x + r) * inv);
  const cy0 = Math.floor((y - r) * inv);
  const cy1 = Math.floor((y + r) * inv);

  const mask = h.bucketMask;
  const bucketStart = h.bucketStart;
  const items = h.items;
  const itemKey = h.itemKey;
  const cap = out.length;
  let n = 0;

  // Exact circle-vs-cell rejection. Walking the AABB alone would also scan the four corner
  // regions, which at r = 260 is ~20% of the cells and admits candidates up to sqrt(2)*(r+cell)
  // away. Rejecting per cell keeps the guarantee tight: nothing beyond r + cellSize*sqrt(2).
  const cellSize = h.cellSize;
  const r2 = r * r;

  for (let cy = cy0; cy <= cy1; cy++) {
    const cellMinY = cy * cellSize;
    const dy = y < cellMinY ? cellMinY - y : y > cellMinY + cellSize ? y - cellMinY - cellSize : 0;
    if (dy > r) continue;
    const dy2 = dy * dy;
    for (let cx = cx0; cx <= cx1; cx++) {
      const cellMinX = cx * cellSize;
      const dx =
        x < cellMinX ? cellMinX - x : x > cellMinX + cellSize ? x - cellMinX - cellSize : 0;
      if (dx * dx + dy2 > r2) continue;

      const key = packCell(cx, cy);
      const b = bucketOf(cx, cy, mask);
      const end = bucketStart[b + 1];
      for (let i = bucketStart[b]; i < end; i++) {
        if (itemKey[i] !== key) continue; // different cell, same bucket
        if (n >= cap) return n;
        out[n++] = items[i];
      }
    }
  }
  return n;
}

/**
 * Same as queryCircleInto but skips enemies already flagged dead. Convenience for targeting and
 * splash, which both want live enemies only; the DEAD check is mandatory there because deferred
 * reaping leaves corpses in the hash until S12 (and the Cannon must never burn a 1.2 s cooldown
 * on one).
 */
export function queryCircleLiveInto(
  h: SpatialHash,
  p: EnemyPool,
  x: number,
  y: number,
  r: number,
  out: Uint16Array,
): number {
  const inv = h.invCellSize;
  const cx0 = Math.floor((x - r) * inv);
  const cx1 = Math.floor((x + r) * inv);
  const cy0 = Math.floor((y - r) * inv);
  const cy1 = Math.floor((y + r) * inv);

  const mask = h.bucketMask;
  const bucketStart = h.bucketStart;
  const items = h.items;
  const itemKey = h.itemKey;
  const flags = p.flags;
  const cap = out.length;
  let n = 0;

  // Exact circle-vs-cell rejection. Walking the AABB alone would also scan the four corner
  // regions, which at r = 260 is ~20% of the cells and admits candidates up to sqrt(2)*(r+cell)
  // away. Rejecting per cell keeps the guarantee tight: nothing beyond r + cellSize*sqrt(2).
  const cellSize = h.cellSize;
  const r2 = r * r;

  for (let cy = cy0; cy <= cy1; cy++) {
    const cellMinY = cy * cellSize;
    const dy = y < cellMinY ? cellMinY - y : y > cellMinY + cellSize ? y - cellMinY - cellSize : 0;
    if (dy > r) continue;
    const dy2 = dy * dy;
    for (let cx = cx0; cx <= cx1; cx++) {
      const cellMinX = cx * cellSize;
      const dx =
        x < cellMinX ? cellMinX - x : x > cellMinX + cellSize ? x - cellMinX - cellSize : 0;
      if (dx * dx + dy2 > r2) continue;

      const key = packCell(cx, cy);
      const b = bucketOf(cx, cy, mask);
      const end = bucketStart[b + 1];
      for (let i = bucketStart[b]; i < end; i++) {
        if (itemKey[i] !== key) continue;
        const d = items[i];
        if ((flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        if (n >= cap) return n;
        out[n++] = d;
      }
    }
  }
  return n;
}
