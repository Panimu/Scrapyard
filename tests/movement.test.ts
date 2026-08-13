/**
 * S3 - updatePlayerMovement.
 *
 * The load-bearing assertion in this file is the one about terminal velocity. Everything else is
 * feel; that one is a CONTENT LAW. `moveDrag` is derived as moveAccel / moveMaxSpeed precisely so
 * that the mech's real top speed equals the number in the tuning table, and the kiting invariant -
 * every hero outruns the worst-case late-game swarmer - is checked against that table. If drag ever
 * becomes independently authored, the table starts lying and the genre quietly breaks; the test
 * below is what refuses to let that happen silently.
 *
 * These call `updatePlayerMovement` directly rather than `stepWorld`, so no director, no horde and
 * no collision can perturb the numbers - a failure here is unambiguously a movement failure.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { maxEnemySpeedAt } from '../src/core/content/enemyCatalog.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { updatePlayerMovement } from '../src/core/systems/playerMovement.js';
import { quantiseAxis, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

/** Heroes are indexed positionally, never by id: the catalog's ids are content, not contract. */
function makeWorld(heroId = 0): World {
  return createWorld({ seed: 1, heroId, runLengthSec: 900, tuning: DEFAULT_TUNING });
}

/** Holds the stick at (mx, my) - quantised exactly as the UI layer would - for `ticks` ticks. */
function drive(world: World, mx: number, my: number, ticks: number): void {
  world.input.moveX = quantiseAxis(mx);
  world.input.moveY = quantiseAxis(my);
  for (let i = 0; i < ticks; i++) updatePlayerMovement(world, DT);
}

function speedOf(world: World): number {
  return Math.sqrt(world.player.vx * world.player.vx + world.player.vy * world.player.vy);
}

/** Long enough for the geometric approach to settle into a float fixed point (~540 ticks). */
const SETTLE_TICKS = 1200;

// ---------------------------------------------------------------------------------------------

describe('terminal velocity - the kiting invariant', () => {
  it('converges to exactly moveMaxSpeed, and never exceeds it, for every hero', () => {
    for (let heroId = 0; heroId < HERO_CATALOG.length; heroId++) {
      const w = makeWorld(heroId);
      const max = w.player.stats.moveMaxSpeed;

      w.input.moveX = quantiseAxis(1);
      w.input.moveY = 0;
      let peak = 0;
      for (let i = 0; i < SETTLE_TICKS; i++) {
        updatePlayerMovement(w, DT);
        const s = speedOf(w);
        // Monotone approach from below: an overshoot of even one ulp would mean the derived-drag
        // relationship had been broken somewhere.
        expect(s).toBeLessThanOrEqual(max);
        if (s > peak) peak = s;
      }

      expect(peak).toBeCloseTo(max, 9);
      expect(max - peak).toBeLessThan(1e-9);
    }
  });

  it('holds moveMaxSpeed >= 1.08x the fastest enemy at t=900, for every hero', () => {
    // Trivially true while every chassis is a skin. It is kept, and kept looping over the WHOLE
    // catalog, because it is exactly the assertion that must fail loudly the day someone gives a
    // hero a moveMaxSpeed multiplier of 0.7.
    const worst = maxEnemySpeedAt(900);
    for (let heroId = 0; heroId < HERO_CATALOG.length; heroId++) {
      const w = makeWorld(heroId);
      expect(w.player.stats.moveMaxSpeed).toBeGreaterThanOrEqual(1.08 * worst);
    }
  });

  it('is not faster on a diagonal - the stick is clamped to unit LENGTH, not per axis', () => {
    const w = makeWorld();
    const max = w.player.stats.moveMaxSpeed;
    drive(w, 1, 1, SETTLE_TICKS);

    expect(speedOf(w)).toBeLessThanOrEqual(max);
    expect(speedOf(w)).toBeCloseTo(max, 9);
    // Equal components: the clamp scaled both axes by the same factor.
    expect(w.player.vx).toBeCloseTo(w.player.vy, 12);
  });

  it('derives drag rather than authoring it', () => {
    const w = makeWorld();
    const s = w.player.stats;
    expect(s.moveDrag).toBe(s.moveAccel / s.moveMaxSpeed);
    // Stability of the explicit integrator: drag * dt must stay well under 1.
    expect(s.moveDrag * DT).toBeLessThan(0.2);
  });
});

describe('weight - the mech accelerates, it does not snap', () => {
  it('reaches only accel * dt in the first tick, not top speed', () => {
    const w = makeWorld();
    const s = w.player.stats;
    drive(w, 1, 0, 1);
    // From rest the drag term is exactly zero, so this is an exact equality.
    expect(w.player.vx).toBe(s.moveAccel * DT);
    expect(w.player.vx).toBeLessThan(s.moveMaxSpeed * 0.07);
  });

  it('crosses 63.2% of top speed on tick 17 (~0.28 s) and 95% on tick 49 (~0.82 s)', () => {
    const w = makeWorld();
    const max = w.player.stats.moveMaxSpeed;
    w.input.moveX = quantiseAxis(1);

    let tau = -1;
    let t95 = -1;
    for (let i = 1; i <= 200; i++) {
      updatePlayerMovement(w, DT);
      const s = speedOf(w);
      if (tau < 0 && s >= max * (1 - 1 / Math.E)) tau = i;
      if (t95 < 0 && s >= max * 0.95) t95 = i;
    }

    expect(tau).toBe(17);
    expect(t95).toBe(49);
    expect(tau * DT).toBeCloseTo(0.283, 3);
  });

  it('coasts about one mech length after the stick is released, without reversing', () => {
    const w = makeWorld();
    drive(w, 1, 0, SETTLE_TICKS);
    const startX = w.player.x;

    w.input.moveX = 0;
    let prev = w.player.vx;
    for (let i = 0; i < 1200; i++) {
      updatePlayerMovement(w, DT);
      // Decay only: never negative, never larger than the tick before.
      expect(w.player.vx).toBeGreaterThanOrEqual(0);
      expect(w.player.vx).toBeLessThanOrEqual(prev);
      prev = w.player.vx;
    }

    // 51.1 u against a 52 u drawn chassis. Documented in playerMovement.ts.
    expect(w.player.x - startX).toBeCloseTo(51.07, 1);
  });
});

describe('facing and interpolation state', () => {
  it('points along velocity, stays unit length, and is held through a full stop', () => {
    const w = makeWorld();
    drive(w, 0, -1, 60);
    expect(w.player.faceX).toBeCloseTo(0, 9);
    expect(w.player.faceY).toBeCloseTo(-1, 9);

    drive(w, 1, 0, 400);
    const len = Math.sqrt(w.player.faceX ** 2 + w.player.faceY ** 2);
    expect(len).toBeCloseTo(1, 12);
    expect(w.player.faceX).toBeCloseTo(1, 9);

    // Coast to a standstill: the hull keeps pointing where it was going rather than snapping to +x.
    drive(w, 0, 0, 5000);
    expect(w.player.faceX).toBeCloseTo(1, 9);
    expect(w.player.faceY).toBeCloseTo(0, 9);
  });

  it('leaves prevX/prevY on the position the mech had before this tick', () => {
    const w = makeWorld();
    drive(w, 1, 0, 30);
    const before = { x: w.player.x, y: w.player.y };
    drive(w, 1, 0, 1);

    expect(w.player.prevX).toBe(before.x);
    expect(w.player.prevY).toBe(before.y);
    expect(w.player.x).toBeGreaterThan(w.player.prevX);
  });

  it('does not drift with a centred stick', () => {
    const w = makeWorld();
    drive(w, 0, 0, 600);
    expect(w.player.x).toBe(0);
    expect(w.player.y).toBe(0);
    expect(speedOf(w)).toBe(0);
  });
});

describe('hull regeneration', () => {
  it('regenerates at hpRegen per second and clamps at maxHp', () => {
    const w = makeWorld();
    w.player.stats.hpRegen = 6;
    w.player.hp = 100;
    const max = w.player.stats.maxHp;

    drive(w, 0, 0, 60);
    expect(w.player.hp).toBeCloseTo(106, 9);

    drive(w, 0, 0, 600);
    expect(w.player.hp).toBe(max);
  });

  it('never regenerates a mech that is already at zero', () => {
    const w = makeWorld();
    w.player.stats.hpRegen = 6;
    w.player.hp = 0;
    drive(w, 0, 0, 60);
    expect(w.player.hp).toBe(0);
  });
});
