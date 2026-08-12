/**
 * reapDead - the ONLY removal site for all three pools, at a fixed pipeline position (S12).
 *
 * Everything upstream marks; nothing upstream destroys. The invariant this buys is the one the
 * whole design rests on:
 *
 *   ALL allocation (S2 spawning, S6 weapons, S10 pickups) happens BEFORE reapDead, and reapDead
 *   is the LAST mutation of any pool in the tick. Therefore a slot can never be freed and
 *   re-allocated within one tick, so every dense index and every spatial-hash entry stays valid
 *   for the entire tick - including the ones held by systems that ran before the kill.
 *
 * It also means the render layer, which drains after stepWorld returns, always sees a coherent
 * pool with prevX/prevY correctly aligned to x/y.
 */

import { reapEnemies } from '../entity/enemyPool.js';
import { reapPickups } from '../entity/pickupPool.js';
import { reapProjectiles } from '../entity/projectilePool.js';
import type { World } from '../types.js';

export function reapDead(world: World): void {
  reapEnemies(world.enemies);
  reapProjectiles(world.projectiles);
  reapPickups(world.pickups);
}
