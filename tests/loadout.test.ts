/**
 * One assertion, for a relationship that has already been got wrong once.
 *
 * `WEAPON_SLOTS` sizes the weapons array. `tools/loadout.ts` fits the WHOLE catalog into it to
 * measure one gun's share of a run against all the others, so a catalog longer than the array
 * throws - which is exactly what adding the ninth weapon did. The constant carried a comment
 * claiming it was sized to the catalog; it was a literal, and nothing checked.
 */

import { describe, expect, it } from 'vitest';
import { WEAPON_CATALOG, WEAPON_SLOTS, MAX_WEAPONS, metaMaxGrant } from '../src/core/index.js';

describe('weapon slots', () => {
  it('has room for the whole catalog, which is what the measurement rig fills', () => {
    expect(WEAPON_SLOTS).toBeGreaterThanOrEqual(WEAPON_CATALOG.length);
  });

  it('still caps a real run well under the array, base and upgraded alike', () => {
    // The rig writes the loadout directly and never goes through `isOfferable`, so widening the
    // array must not widen the RULE.
    //
    // MAX_WEAPONS IS THE BASE NOW, not the ceiling - Reinforced Mounts buys the fifth slot (see
    // World.maxWeapons) - so what has to hold is that even a fully upgraded save stays inside the
    // array. Asserted against the catalog's own ceiling rather than a literal, so a second slot
    // upgrade cannot quietly overrun WEAPON_SLOTS.
    expect(MAX_WEAPONS).toBe(4);
    expect(MAX_WEAPONS + metaMaxGrant('weaponSlots')).toBe(5);
    expect(MAX_WEAPONS + metaMaxGrant('weaponSlots')).toBeLessThan(WEAPON_SLOTS);
  });
});
