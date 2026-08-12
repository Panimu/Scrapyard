/**
 * ALIAS MODULE. The canonical implementation is `src/core/world.ts` (createWorld, stepWorld,
 * the ordered pipeline) and `src/core/types.ts` (World, InputFrame, RunPhase and friends).
 *
 * This file exists only because the world/ path appears in some task descriptions. New code
 * should import the canonical modules - or `src/core/index.ts` from outside core - so that the
 * determinism guard test, which parses `src/core/world.ts` for DT call sites, is looking at the
 * same file everyone else is reading.
 */

export * from '../world.js';
export * from '../types.js';
