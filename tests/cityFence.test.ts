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
  CITY_BARREL,
  CITY_EMPTY,
  CITY_FENCE,
  FENCE_SECTIONS,
  FENCE_SECTION_HP,
  cityCentre,
  cityFenceRing,
  cityIsRoad,
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

    // A zero-damage touch opens nothing. On the barrel path it took the whole cell, because a drum
    // ignores the amount by design - which is what made the fences free. (The mech's own shove is
    // not zero: `updatePlayerMovement` spends MECH_SHOVE_DPS, so leaning on a fence does open it,
    // over about a second. That is the same deal Mossy's trees give and it is intended.)
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

/**
 * THE DRUMS THAT REPLACED THE FLOCK. Two promises, and the first one is the one a player would
 * notice being broken: a barrel standing in the middle of a road is a barrel in the one place the
 * whole map is designed to keep clear, and it would be there on every seed at once.
 */
describe('city fuel drums', () => {
  it('never stand on a road', () => {
    // Every seed, every cell of a six-period window - this is cheap and the property is absolute,
    // so there is no reason to sample it.
    for (const seed of [1, 2, 3, 7, 12345]) {
      const w = createWorld({
        seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos',
      });
      if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
      for (let cy = -30; cy < 30; cy++) {
        for (let cx = -30; cx < 30; cx++) {
          if (!cityIsRoad(cx, cy)) continue;
          expect(cityKindAt(w.scenery, cx, cy)).toBe(CITY_EMPTY);
        }
      }
    }
  });

  it('pay out and go over on contact, the way a yard drum does', () => {
    const w = createWorld({
      seed: 3, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos',
    });
    if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
    const city = w.scenery;

    const drums: Array<[number, number]> = [];
    for (let cy = -40; cy < 40; cy++) {
      for (let cx = -40; cx < 40; cx++) {
        if (cityKindAt(city, cx, cy) === CITY_BARREL) drums.push([cx, cy]);
      }
    }
    // A window this size with no drums at all would mean the share is wrong, which is worth
    // failing on rather than skipping past. Twelve is comfortably under what 80x80 cells yields.
    expect(drums.length, 'seed 3 should have drums near the origin').toBeGreaterThan(12);

    const barrels = w.stats.barrelsBroken;
    const pickups = w.pickups.count;

    for (const [cx, cy] of drums.slice(0, 12)) {
      const fx = cityCentre(cx);
      const fy = cityCentre(cy);
      // On screen, or the drum is spared - the same guard the yard's own barrels get.
      w.player.x = fx + 60;
      w.player.y = fy;
      // ANY damage takes it: no section pool, no dimmed half state. One shell, one drum.
      expect(breakLootIn(w, fx, fy, 0, 1)).toBe(true);
      expect(cityKindAt(city, cx, cy)).toBe(CITY_EMPTY);
    }

    expect(w.stats.barrelsBroken).toBe(barrels + 12);
    // Twelve drums' worth of rolls. The empty chance means no single one is guaranteed, so this
    // asserts the PATH is wired rather than a particular roll - the same reasoning the flock's
    // own test uses, and twelve consecutive empties is not a thing this seed does.
    expect(w.pickups.count).toBeGreaterThan(pickups);
  });
});
