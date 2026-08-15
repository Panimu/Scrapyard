/**
 * S8 - updateCollision. DETECTION ONLY. This stage applies nothing.
 *
 * It writes two per-tick buffers and touches nothing else that matters:
 *   HitBuffer      one record per (projectile, enemy) pass that is allowed to land this tick
 *   ContactBuffer  one record per enemy touching the player whose own contact cooldown is up
 *
 * updateDamage (S9) reads both and is the only stage that changes an hp number. The split is not
 * tidiness: it makes damage ORDER an explicit property of a buffer rather than an emergent
 * property of loop nesting, and it lets each half be tested alone - a broad-phase bug and an
 * armour-formula bug produce failures in different files.
 *
 * ---------------------------------------------------------------------------------------------
 * BROAD PHASE - the spatial hash, never a pool scan
 * ---------------------------------------------------------------------------------------------
 * Both passes iterate the small side and QUERY the large one: at most 256 shells and exactly one
 * player, each issuing one circle query against the enemy hash. Nothing here is O(n^2) over all
 * entities; the cost is O(shells x candidates-per-cell-neighbourhood), which at endgame density is
 * a few thousand squared-distance tests per tick.
 *
 * Query radius is `ownRadius + MAX_ENEMY_RADIUS` because the hash indexes enemy CENTRES, so the
 * pad has to cover the largest body that could be reaching into the circle from outside it (the
 * Scraplord, 56 u). Candidates are a superset - hashGrid says so loudly - so every candidate is
 * re-checked against exact squared distance before it becomes a record.
 *
 * NO SWEPT TEST. A Cannon shell moves 8.67 u per tick against a smallest enemy radius of 13 u, so
 * point-in-circle at the post-integration position cannot tunnel (DESIGN.md §7.3). If a future
 * weapon fires faster than the smallest radius per tick, THIS is the comment that has to change.
 *
 * ---------------------------------------------------------------------------------------------
 * PIERCE, AND WHY ORDER MATTERS
 * ---------------------------------------------------------------------------------------------
 * A shell may land at most `pierceLeft + 1` passes in a tick: pierce 0 hits exactly one body,
 * pierce 2 hits three. Across ticks, re-hits are prevented by the projectile's own hit ring, which
 * remembers the last HIT_RING_STRIDE (4) enemy spawnIds it damaged - spawnIds are never recycled,
 * so a recycled dense index cannot resurrect an old grudge. Four slots is exactly the maximum
 * number of passes the shipping pool allows (Sabot Rounds caps at pierce 3), so the ring can never
 * forget a body this shell is still overlapping.
 *
 * When a shell straddles MORE bodies in one tick than it has passes left, the ones it takes are
 * the NEAREST ones, ordered nearest-first, ties broken by lower spawnId. That ordering is visible
 * in the game because updateDamage applies pierceFalloff per pass: without it, "which of the three
 * runts under the shell takes full damage" would be decided by the cell-walk order of a hash,
 * which is deterministic but arbitrary and untestable as a rule.
 *
 * The selection is a partial selection sort over the compacted candidate list - O(passes x k) with
 * passes <= 4 - rather than a full sort, so the common case (one overlap) costs one comparison and
 * nothing allocates.
 *
 * ---------------------------------------------------------------------------------------------
 * CONTACT IS GATED PER ENEMY, NOT BY PLAYER I-FRAMES
 * ---------------------------------------------------------------------------------------------
 * Every enemy carries its own `contactTimer`, rearmed by S9 to its archetype's `contactInterval`
 * each time it actually bills the player. Global invulnerability frames would let one runt soak
 * the window on behalf of the bruiser arriving half a second later - being surrounded would be
 * SAFER than being cornered, which inverts the entire threat model. Here, six runts in contact
 * genuinely deal six runts' worth of damage (~50 dps, dead in 2.4 s at base HP), which is what
 * tuning.ts promises.
 *
 * OWNERSHIP OF `contactTimer`, stated exactly, because two stages touch it:
 *   S8 (here)  runs the clock - one linear decrement per live enemy per tick - and emits a contact
 *              only for an enemy whose timer has reached 0. So the ContactBuffer means
 *              "damage-eligible touch", not "touch".
 *   S9         rearms the timer at the moment it actually applies the damage.
 * Splitting it this way is what stops a contact from arming a cooldown it never got billed for -
 * an enemy that dies to a shell earlier in S9 has its contact dropped, and its timer untouched.
 */

import { MAX_ENEMY_RADIUS } from '../content/cycles.js';
import {
  PROJECTILE_FLAG_DEAD,
  PROJECTILE_FLAG_NOCONTACT,
  projectileHasHit,
  projectileRecordHit,
} from '../entity/projectilePool.js';
import { pushContact, pushHit } from '../events/ring.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import type { World } from '../types.js';

export function updateCollision(world: World, dt: number): void {
  advanceContactTimers(world, dt);
  collideProjectilesWithEnemies(world);
  collidePlayerWithEnemies(world);
}

// -------------------------------------------------------------------------------------------
// Contact cooldowns
// -------------------------------------------------------------------------------------------

/**
 * One linear pass over the dense range, clamped at 0.
 *
 * A LINEAR SCAN ON PURPOSE, like the director's threat measurement: every live enemy's timer has
 * to advance whether or not it is anywhere near the player, and 300 contiguous float subtractions
 * is cheaper than any structure that could tell us which ones to skip. Clamping at 0 rather than
 * letting it run negative keeps the field's byte pattern - and therefore the world hash - from
 * drifting for enemies that never touch anything.
 */
function advanceContactTimers(world: World, dt: number): void {
  const p = world.enemies;
  const timer = p.contactTimer;
  const n = p.count;
  for (let d = 0; d < n; d++) {
    const left = timer[d];
    if (left <= 0) continue;
    const next = left - dt;
    timer[d] = next > 0 ? next : 0;
  }
}

// -------------------------------------------------------------------------------------------
// Projectile -> enemy
// -------------------------------------------------------------------------------------------

function collideProjectilesWithEnemies(world: World): void {
  const proj = world.projectiles;
  const n = proj.count;
  if (n === 0) return;

  const enemies = world.enemies;
  const hash = world.spatial;
  const candidates = world.scratch.candidates;
  const hits = world.hits;

  const ex = enemies.x;
  const ey = enemies.y;
  const eRadius = enemies.radius;
  const eSpawnId = enemies.spawnId;

  for (let pd = 0; pd < n; pd++) {
    // A shell that expired in S7 is still in the pool until S12. It must not land.
    if ((proj.flags[pd] & (PROJECTILE_FLAG_DEAD | PROJECTILE_FLAG_NOCONTACT)) !== 0) continue;

    // pierceLeft is "bodies AFTER this one", so a fresh pierce-0 shell has exactly one pass.
    const passes = proj.pierceLeft[pd] + 1;
    if (passes <= 0) continue;

    const px = proj.x[pd];
    const py = proj.y[pd];
    const pr = proj.radius[pd];

    const found = queryCircleLiveInto(
      hash,
      enemies,
      px,
      py,
      pr + MAX_ENEMY_RADIUS,
      candidates,
    );
    if (found === 0) continue;

    // Compact the true overlaps this shell has not already damaged to the front of the candidate
    // buffer. Everything after this point works on [0, m) and never re-reads the rejected tail.
    let m = 0;
    for (let i = 0; i < found; i++) {
      const ed = candidates[i];
      const dx = ex[ed] - px;
      const dy = ey[ed] - py;
      const reach = pr + eRadius[ed];
      if (dx * dx + dy * dy > reach * reach) continue;
      if (projectileHasHit(proj, pd, eSpawnId[ed])) continue;
      candidates[m++] = ed;
    }
    if (m === 0) continue;

    const take = m < passes ? m : passes;
    for (let k = 0; k < take; k++) {
      // Partial selection sort: pull the nearest remaining candidate into slot k. Strict total
      // order (distance, then spawnId), so the result cannot depend on hash visit order.
      let best = k;
      let bestD2 = dist2To(ex, ey, candidates[k], px, py);
      for (let i = k + 1; i < m; i++) {
        const cd = candidates[i];
        const d2 = dist2To(ex, ey, cd, px, py);
        if (d2 < bestD2 || (d2 === bestD2 && eSpawnId[cd] < eSpawnId[candidates[best]])) {
          best = i;
          bestD2 = d2;
        }
      }
      if (best !== k) {
        const swap = candidates[k];
        candidates[k] = candidates[best];
        candidates[best] = swap;
      }

      const ed = candidates[k];
      // Recorded HERE rather than in S9 so that a shell cannot be handed the same body twice
      // within this tick's own selection, and cannot re-acquire it on any later tick.
      projectileRecordHit(proj, pd, eSpawnId[ed]);
      // Impact point is the shell's centre: it is what the FX layer wants to draw and what S9
      // uses as the splash origin.
      pushHit(hits, pd, ed, px, py);
    }
  }
}

function dist2To(ex: Float32Array, ey: Float32Array, d: number, x: number, y: number): number {
  const dx = ex[d] - x;
  const dy = ey[d] - y;
  return dx * dx + dy * dy;
}

// -------------------------------------------------------------------------------------------
// Enemy -> player
// -------------------------------------------------------------------------------------------

function collidePlayerWithEnemies(world: World): void {
  const enemies = world.enemies;
  if (enemies.count === 0) return;

  const player = world.player;
  const px = player.x;
  const py = player.y;
  const pr = player.stats.radius;

  const candidates = world.scratch.candidates;
  const found = queryCircleLiveInto(
    world.spatial,
    enemies,
    px,
    py,
    pr + MAX_ENEMY_RADIUS,
    candidates,
  );
  if (found === 0) return;

  const contacts = world.contacts;
  const timer = enemies.contactTimer;

  for (let i = 0; i < found; i++) {
    const ed = candidates[i];
    // Its own cooldown, not the player's. See the header.
    if (timer[ed] > 0) continue;
    const dx = enemies.x[ed] - px;
    const dy = enemies.y[ed] - py;
    const reach = pr + enemies.radius[ed];
    if (dx * dx + dy * dy > reach * reach) continue;
    pushContact(contacts, ed);
  }
}
