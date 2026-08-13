/**
 * PUBLIC BARREL for the render, UI and harness layers.
 *
 * Those layers import from `src/core` and nothing deeper. The reverse never happens: core has
 * no import that escapes this directory, which is what makes it runnable in bare Node and
 * checkable by tsconfig.core.json.
 *
 * Core code itself should import the specific module, not this barrel - a barrel import inside
 * core creates import cycles that only show up as `undefined` at module-init time.
 */

// ---- kernel --------------------------------------------------------------------------------
export * from './constants.js';
export * from './types.js';
export * from './rng.js';
export * from './hash.js';
export * from './simulation.js';
export { createWorld, stepWorld, beginTick, endTick, reapDead, DEFAULT_CATALOGS } from './world.js';

export * from './math/scalar.js';
export * from './math/vec2.js';
export * from './math/trig.js';

export * from './entity/handle.js';
export * from './entity/enemyPool.js';
export * from './entity/projectilePool.js';
export * from './entity/pickupPool.js';

export * from './spatial/hashGrid.js';
export * from './events/ring.js';

// ---- tuning --------------------------------------------------------------------------------
export * from './config/tuning.js';

// ---- content (catalogs + definition types) -------------------------------------------------
// `export *` rather than named re-exports on purpose: the content agent owns the exact split
// between these files, and a star export follows a symbol wherever it lands.
export * from './data/stats.js';
export * from './data/weapons.js';
export * from './data/enemies.js';
export * from './content/cycles.js';
export * from './data/heroes.js';
export * from './data/upgrades.js';
export * from './data/traits.js';
