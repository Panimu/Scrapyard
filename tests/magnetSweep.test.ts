/**
 * WHAT A RUNNING MAGNET PICKS UP, and what a broken drum leaves behind.
 *
 * Two small promises that are easy to get wrong in opposite directions.
 *
 * THE MAGNET. Consumables deliberately do not chase and are not chased - a spanner that flew to
 * you answers the question the barrel asked by posing it. But the magnet is the one pickup whose
 * entire proposition is that it collects for you, and it used to hoover the XP off the floor while
 * leaving the money and the repairs lying exactly where they fell. The default stands; the magnet
 * is the exception, and only for coins and spanners.
 *
 * THE DRUM. Fences and drums share one broken set, so after the fact "was something here" is true
 * of both and `cityKindAt` says EMPTY for both. With nothing else to ask, a drum that went up left
 * a heap of splintered fence boards in the street. `cityPristineKindAt` is what tells them apart,
 * so it is what this pins.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CITY_BARREL,
  CITY_EMPTY,
  CITY_FENCE,
  cityCentre,
  cityKindAt,
  cityPristineKindAt,
} from '../src/core/content/wallsCity.js';
import { breakLootIn } from '../src/core/systems/pickups.js';
import {
  PICKUP_KIND_CREDIT,
  PICKUP_KIND_DICE,
  PICKUP_KIND_REPAIR,
  allocPickup,
} from '../src/core/entity/pickupPool.js';
import { updatePickups } from '../src/core/systems/pickups.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

function world(): World {
  const w = createWorld({ seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING });
  w.phase = RUN_PHASE_RUNNING;
  w.player.x = 0;
  w.player.y = 0;
  return w;
}

/** Drops one pickup well outside the walk-over radius and returns its dense index. */
function drop(w: World, kind: number, x: number): number {
  allocPickup(w.pickups, kind, 10, 0, x, 0, 1000 + w.pickups.count);
  return w.pickups.count - 1;
}

/** How far the pickup at `d` sits from the player. */
function range(w: World, d: number): number {
  const dx = w.pickups.x[d] - w.player.x;
  const dy = w.pickups.y[d] - w.player.y;
  return Math.sqrt(dx * dx + dy * dy);
}

describe('a running magnet', () => {
  it('drags coins and spanners in, and leaves the dice where it lies', () => {
    const w = world();
    const coin = drop(w, PICKUP_KIND_CREDIT, 200);
    const spanner = drop(w, PICKUP_KIND_REPAIR, 240);
    const dice = drop(w, PICKUP_KIND_DICE, 280);
    // The mech has taken a knock, so the spanner is worth something and is not refused.
    w.player.hp = w.player.stats.maxHp - 50;

    const before = [range(w, coin), range(w, spanner), range(w, dice)];
    w.player.magnetSec = 5;
    for (let t = 0; t < 30; t++) updatePickups(w, DT);

    expect(range(w, coin), 'coin should have closed on the mech').toBeLessThan(before[0] - 20);
    expect(range(w, spanner), 'spanner should have closed on the mech').toBeLessThan(before[1] - 20);
    // The dice is not what a magnet is for, and nothing should have moved it.
    expect(range(w, dice)).toBeCloseTo(before[2], 6);
  });

  it('moves neither of them with no magnet running', () => {
    const w = world();
    const coin = drop(w, PICKUP_KIND_CREDIT, 200);
    const spanner = drop(w, PICKUP_KIND_REPAIR, 240);
    w.player.hp = w.player.stats.maxHp - 50;

    const before = [range(w, coin), range(w, spanner)];
    expect(w.player.magnetSec).toBe(0);
    for (let t = 0; t < 30; t++) updatePickups(w, DT);

    // The default the barrels are built around: you walk to it or you do not have it.
    expect(range(w, coin)).toBeCloseTo(before[0], 6);
    expect(range(w, spanner)).toBeCloseTo(before[1], 6);
  });

  it('does not produce a NaN when a refused spanner is dragged onto the mech exactly', () => {
    // `1 / sqrt(0)` is Infinity and `0 * Infinity` is NaN, and a spanner is the one pickup that
    // can sit at EXACTLY zero distance and stay there: magnetised to the mech at full hull, then
    // refused rather than taken. A NaN position is a pickup that can never be collected and never
    // draws again.
    const w = world();
    const spanner = drop(w, PICKUP_KIND_REPAIR, 0);
    w.pickups.y[spanner] = 0;
    w.player.hp = w.player.stats.maxHp; // full: `wouldBeWasted` refuses it, so it is never taken
    w.player.magnetSec = 5;

    for (let t = 0; t < 60; t++) updatePickups(w, DT);

    expect(Number.isFinite(w.pickups.x[spanner])).toBe(true);
    expect(Number.isFinite(w.pickups.y[spanner])).toBe(true);
  });
});

describe('a broken drum', () => {
  it('is still known to have been a drum, so the dressing can leave no rubble', () => {
    const w = createWorld({
      seed: 3, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'city-chaos',
    });
    if (w.scenery.kind !== 'city') throw new Error('expected the city grid');
    const city = w.scenery;

    let drum: [number, number] | null = null;
    let fence: [number, number] | null = null;
    for (let cy = -40; cy < 40 && (!drum || !fence); cy++) {
      for (let cx = -40; cx < 40 && (!drum || !fence); cx++) {
        const k = cityKindAt(city, cx, cy);
        if (!drum && k === CITY_BARREL) drum = [cx, cy];
        if (!fence && k === CITY_FENCE) fence = [cx, cy];
      }
    }
    if (!drum || !fence) throw new Error('seed 3 should have both a drum and a fence');

    for (const [cx, cy] of [drum, fence]) {
      const x = cityCentre(cx);
      const y = cityCentre(cy);
      w.player.x = x + 60;
      w.player.y = y;
      // Enough to take either outright - a drum ignores the amount, a fence spends its pool.
      for (let i = 0; i < 4; i++) breakLootIn(w, x, y, 0, 1000);
      expect(cityKindAt(city, cx, cy)).toBe(CITY_EMPTY);
    }

    // Both are gone from the world, and the pristine query still tells them apart. That is the
    // whole mechanism: rubble is drawn for the fence and withheld from the drum.
    expect(cityPristineKindAt(city, drum[0], drum[1])).toBe(CITY_BARREL);
    expect(cityPristineKindAt(city, fence[0], fence[1])).toBe(CITY_FENCE);
  });
});
