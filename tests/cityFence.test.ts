/**
 * A SITE FENCE IS A TREE, NOT A DRUM - the contract `breakLootIn`'s city branch exists to keep.
 *
 * It shipped on the barrel path by omission, which was wrong three ways at once, and each one is
 * pinned here because none of them fails loudly anywhere else:
 *
 *   IT DROPPED LOOT. A consumable per fence cell turned every construction site into a wall of
 *   free spanners - loot is what barrels are for, and City Chaos's drums already exist separately.
 *   IT IGNORED THE SECTION POOL. `FENCE_SECTIONS x FENCE_SECTION_HP` was written, rendered (the
 *   half-broken dim state), and never spent: every cell burst on first contact, including the
 *   mech leaning on it, which made the fences free to open instead of a thing you spend ammo on.
 *   IT COUNTED AS A BARREL. `stats.barrelsBroken` fed on fence cells, which is the kind of quiet
 *   stat pollution an unlock condition would eventually be written against.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CITY_EMPTY,
  CITY_FENCE,
  FENCE_SECTIONS,
  FENCE_SECTION_HP,
  cityCentre,
  cityFenceRing,
  cityKindAt,
  citySectionsStanding,
  isCityBroken,
  type CityBlocks,
} from '../src/core/content/wallsCity.js';
import { breakLootIn } from '../src/core/systems/pickups.js';
import { createWorld } from '../src/core/world.js';
import type { World } from '../src/core/types.js';

/** A city world plus the first RING fence cell found near the origin - a real generated barrier. */
function worldWithFence(seed: number): { w: World; city: CityBlocks; cx: number; cy: number } {
  const w = createWorld({
    seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos',
  });
  if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
  const city = w.scenery;
  for (let cy = -40; cy < 40; cy++) {
    for (let cx = -40; cx < 40; cx++) {
      if (cityKindAt(city, cx, cy) === CITY_FENCE && cityFenceRing(cx, cy)) {
        return { w, city, cx, cy };
      }
    }
  }
  throw new Error('seed has no construction site in the scan');
}

describe('breaking a site fence', () => {
  it('spends the section pool and never pays out', () => {
    const { w, city, cx, cy } = worldWithFence(7);
    const x = cityCentre(cx);
    const y = cityCentre(cy);
    // Stand the mech next to the cell: the barrel path this used to take has an on-screen guard,
    // so a test standing at the default spawn would pass for the wrong reason.
    w.player.x = x + 80;
    w.player.y = y;
    const pickups = w.pickups.count;
    const barrels = w.stats.barrelsBroken;

    // The mech shoving (damage 0) opens nothing - fences are shot down or not at all. This is
    // the exact call updatePlayerMovement makes, and on the barrel path it took the cell.
    expect(breakLootIn(w, x, y, 30, 0)).toBe(false);
    expect(cityKindAt(city, cx, cy)).toBe(CITY_FENCE);

    // One section's worth: the cell dims but stands. Half a fence is not a hole.
    expect(breakLootIn(w, x, y, 0, FENCE_SECTION_HP)).toBe(true);
    expect(citySectionsStanding(city, cx, cy)).toBe(FENCE_SECTIONS - 1);
    expect(cityKindAt(city, cx, cy)).toBe(CITY_FENCE);

    // The rest of the pool: NOW it opens.
    expect(breakLootIn(w, x, y, 0, FENCE_SECTION_HP * (FENCE_SECTIONS - 1))).toBe(true);
    expect(cityKindAt(city, cx, cy)).toBe(CITY_EMPTY);
    expect(isCityBroken(city, cx, cy)).toBe(true);

    // And through all of it: nothing dropped, nothing counted as a barrel.
    expect(w.pickups.count).toBe(pickups);
    expect(w.stats.barrelsBroken).toBe(barrels);
  });
});
