/**
 * ALIAS MODULE. The canonical implementation is `src/core/content/enemyCatalog.ts`:
 * ARCHETYPES, FLAVOURS, ENEMY_CATALOG and the derived lookup tables the spawner uses.
 *
 * This path exists because `src/core/world.ts`, `types.ts`, `index.ts` and `tools/sim.ts` were
 * all written against `data/enemies.js`, while the enemy agent's file list names
 * `content/enemyCatalog.ts`. Same convention as `src/core/content/definitions.ts`, pointed the
 * other way: a star export follows a symbol wherever it lands, so both paths resolve to one
 * catalog and there is no second copy to drift.
 */

export * from '../content/enemyCatalog.js';
