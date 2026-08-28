/**
 * S9b - PUDDLES: sludge on the floor, ticking down and billing whatever is standing in it.
 *
 * AFTER S9 (updateDamage) AND BEFORE S10 (updatePickups), which is a statement about what it
 * READS and what reads it. It kills through `killEnemy`, so the gem it earns has to land in the
 * same tick's pickup pass exactly as a shell's does; and it runs after the shots because a body
 * the guns have already finished should not be billed a second time for standing on the spot it
 * fell.
 *
 * IT IS NOT IN `updateDamage`, unlike the burn tick, and the difference is worth stating. Burning
 * is a property OF AN ENEMY - it lives in the enemy pool and is advanced with the other per-enemy
 * timers. A puddle is a thing in the world with its own lifetime, its own pool and its own reaping;
 * the damage is what it does, not what it is.
 */

import { ENEMY_FLAG_DEAD } from '../entity/enemyPool.js';
import { freePuddle } from '../entity/puddlePool.js';
import { queryCircleLiveInto } from '../spatial/hashGrid.js';
import { damageEnemy, markSecondary } from './damage.js';
import type { World } from '../types.js';

export function updatePuddles(world: World, dt: number): void {
  const pools = world.puddles;
  const enemies = world.enemies;
  const candidates = world.scratch.candidates;

  // DOWNWARD, because `freePuddle` swap-removes: iterating up would skip whatever was swapped into
  // the slot just vacated. The same contract every pool in this game has.
  for (let d = pools.count - 1; d >= 0; d--) {
    const left = pools.left[d] - dt;
    pools.left[d] = left > 0 ? left : 0;

    const dps = pools.dps[d];
    const r = pools.radius[d];
    if (dps > 0 && r > 0) {
      const x = pools.x[d];
      const y = pools.y[d];
      const amount = dps * dt;
      const r2 = r * r;
      const n = queryCircleLiveInto(world.spatial, enemies, x, y, r, candidates);
      for (let i = 0; i < n; i++) {
        const ed = candidates[i];
        if ((enemies.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;
        // THE BROAD-PHASE IS A GRID, so it returns cell neighbours rather than circle members.
        // Without this the puddle would bill a square, and a square is exactly the shape the
        // player cannot see on the ground.
        const dx = enemies.x[ed] - x;
        const dy = enemies.y[ed] - y;
        if (dx * dx + dy * dy > r2) continue;
        // COUNTED BEFORE THE DAMAGE, so a body the pool finishes still counts as having stood in
        // it - the same ordering `applySplash` uses to light a fire before the kill check.
        markSecondary(world, ed);
        damageEnemy(world, ed, amount, pools.by[d]);
      }
    }

    if (pools.left[d] <= 0) freePuddle(pools, d);
  }
}
