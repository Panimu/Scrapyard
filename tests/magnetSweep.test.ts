/**
 * WHAT A RUNNING MAGNET PICKS UP, and what a broken drum leaves behind.
 *
 * Two small promises that are easy to get wrong in opposite directions.
 *
 * THE MAGNET. Consumables deliberately do not chase and are not chased, and the magnet is the one
 * exception - it is the pickup whose entire proposition is that it collects for you, and one that
 * hoovered the XP off the floor while leaving everything else lying there reads as broken.
 *
 * THE EXCEPTION IS COINS AND THE DICE, AND POINTEDLY NOT SPANNERS. It used to be coins and
 * spanners. A spanner is the one pickup whose whole value is the QUESTION it poses - is that worth
 * crossing the field for, right now, at this much hull - and a magnet that delivered it answered
 * the question on the player's behalf, which is the one thing the barrel exists to make them do.
 * The dice is the opposite: one a run is the point of it, there is no decision to take away, and
 * only a walk across the yard that adds nothing.
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
  PICKUP_KIND_GEM,
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
  it('drags coins and the dice in, and leaves the spanner where it lies', () => {
    const w = world();
    const coin = drop(w, PICKUP_KIND_CREDIT, 200);
    const spanner = drop(w, PICKUP_KIND_REPAIR, 240);
    const dice = drop(w, PICKUP_KIND_DICE, 280);
    // The mech has taken a knock, so the spanner is worth something and is not refused on VALUE -
    // which is what makes this a test of the magnet rule rather than of `wouldBeWasted`.
    w.player.hp = w.player.stats.maxHp - 50;

    const before = [range(w, coin), range(w, spanner), range(w, dice)];
    w.player.magnetSec = 5;
    for (let t = 0; t < 30; t++) updatePickups(w, DT);

    expect(range(w, coin), 'coin should have closed on the mech').toBeLessThan(before[0] - 20);
    expect(range(w, dice), 'dice should have closed on the mech').toBeLessThan(before[2] - 20);
    // The spanner keeps its distance, and the decision it poses stays the player's.
    expect(range(w, spanner)).toBeCloseTo(before[1], 6);
  });

  it('keeps pulling a gem that has left the field - the field acquires, it does not leash', () => {
    // THE BUG THIS PINS: the radius used to be tested every tick, so a gem dragged halfway and
    // then walked away from stopped dead in open ground with no velocity. Nothing on screen
    // explains that - it reads as gems the game lost track of.
    const w = world();
    const gem = drop(w, PICKUP_KIND_GEM, 0);
    w.pickups.x[gem] = w.player.stats.pickupRadius - 10; // just inside: acquired on tick one
    w.pickups.y[gem] = 0;

    updatePickups(w, DT);
    const acquired = range(w, gem);

    // Now the mech leaves, putting the gem far outside any reading of the field.
    w.player.x = -4000;
    const before = range(w, gem);
    for (let t = 0; t < 30; t++) updatePickups(w, DT);

    expect(acquired).toBeGreaterThan(0);
    expect(range(w, gem), 'the gem should still be closing').toBeLessThan(before);
  });

  it('never starts on a gem that was always out of reach', () => {
    // The other half of the same rule: acquisition is what latches, so a gem the field has never
    // held is still left exactly where it fell.
    const w = world();
    const gem = drop(w, PICKUP_KIND_GEM, w.player.stats.pickupRadius + 400);
    const before = range(w, gem);

    for (let t = 0; t < 30; t++) updatePickups(w, DT);
    expect(range(w, gem)).toBeCloseTo(before, 6);
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

  it('does not produce a NaN when a refused pickup sits on the mech exactly', () => {
    // `1 / sqrt(0)` is Infinity and `0 * Infinity` is NaN, and a NaN position is a pickup that can
    // never be collected and never draws again.
    //
    // A SPANNER IS STILL THE CASE TO TEST even though the magnet no longer drags one: it is the
    // pickup that can sit at exactly zero distance and STAY there, because `wouldBeWasted` refuses
    // it at full hull rather than taking it. The zero-distance guard is what keeps that safe, and
    // it has to keep holding whether or not anything is pulling.
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
