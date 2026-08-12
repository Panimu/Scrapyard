/**
 * ALIAS MODULE. The canonical implementation is `src/core/spatial/hashGrid.ts`:
 * createSpatialHash, rebuildSpatialHash (counting sort), queryCircleInto and
 * queryCircleLiveInto - the broad-phase behind collision, separation, splash and the Cannon's
 * highest-HP-in-range query.
 */

export * from '../spatial/hashGrid.js';
