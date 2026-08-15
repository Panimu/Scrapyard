/**
 * One assertion, for a relationship that has already been got wrong once.
 *
 * `WEAPON_SLOTS` sizes the weapons array. `tools/loadout.ts` fits the WHOLE catalog into it to
 * measure one gun's share of a run against all the others, so a catalog longer than the array
 * throws - which is exactly what adding the ninth weapon did. The constant carried a comment
 * claiming it was sized to the catalog; it was a literal, and nothing checked.
 */

import { describe, expect, it } from 'vitest';
import { WEAPON_CATALOG, WEAPON_SLOTS, MAX_WEAPONS } from '../src/core/index.js';

describe('weapon slots', () => {
  it('has room for the whole catalog, which is what the measurement rig fills', () => {
    expect(WEAPON_SLOTS).toBeGreaterThanOrEqual(WEAPON_CATALOG.length);
  });

  it('still caps a real run at five guns', () => {
    // The rig writes the loadout directly and never goes through `isOfferable`, so widening the
    // array must not widen the RULE.
    expect(MAX_WEAPONS).toBe(5);
    expect(MAX_WEAPONS).toBeLessThan(WEAPON_SLOTS);
  });
});
