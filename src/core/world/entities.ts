/**
 * ALIAS MODULE. The canonical implementations are:
 *   src/core/entity/handle.ts         - packed (generation << 16) | slot handles
 *   src/core/entity/enemyPool.ts      - EnemyPool, allocEnemy, markEnemyDead, reapEnemies
 *   src/core/entity/projectilePool.ts - ProjectilePool and the per-shell hit ring
 *   src/core/entity/pickupPool.ts     - PickupPool
 *
 * Prefer importing those directly (or `src/core/index.ts` from outside core).
 */

export * from '../entity/handle.js';
export * from '../entity/enemyPool.js';
export * from '../entity/projectilePool.js';
export * from '../entity/pickupPool.js';
export type { NumericArray } from '../entity/layout.js';
