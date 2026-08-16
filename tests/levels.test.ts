/**
 * Levels, and the one thing that actually distinguishes them today: whether the world has edges.
 *
 * "TRUE INFINITE IN ALL DIRECTIONS" is a claim that is trivially easy to half-implement - clamp
 * the player and forget the enemies, or clamp neither and leave the projectiles culled at 6144.
 * So this walks the mech a long way past the Scrapyard's wall in every direction and checks that
 * the systems which USED to stop it no longer do.
 */

import { describe, expect, it } from 'vitest';

import { ARENA_HALF } from '../src/core/constants.js';
import { LEVEL_CATALOG, levelById, levelOrDefault } from '../src/core/content/levels.js';
import { hashWorld } from '../src/core/hash.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_RUNNING,
  quantiseAxis,
  type InputFrame,
  type World,
} from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

function world(levelId: string): World {
  const w = createWorld({
    seed: 4242,
    heroId: 0,
    runLengthSec: 900,
    tuning: DEFAULT_TUNING,
    levelId,
  });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/**
 * Holds the stick in one direction for `ticks`.
 *
 * `chooseIndex: 0` ALWAYS, and it is not incidental. A level-up freezes the world until the player
 * picks a card, so a walk test that sent -1 would travel for about four seconds, stop at the first
 * card, and then measure nothing for the remaining seventy-six. That is exactly how the first draft
 * of this file "proved" the world was still bounded.
 */
function run(w: World, dx: number, dy: number, ticks: number): void {
  const input: InputFrame = {
    moveX: quantiseAxis(dx),
    moveY: quantiseAxis(dy),
    buttons: 0,
    chooseIndex: 0,
  };
  for (let i = 0; i < ticks; i++) stepWorld(w, input);
}

describe('the catalog', () => {
  it('both levels are playable and every one names a floor', () => {
    for (const level of LEVEL_CATALOG) {
      expect(level.floor).not.toBe('');
      expect(Number.isNaN(level.arenaHalf)).toBe(false);
    }
    expect(levelById('mossy-mayhem')?.playable).toBe(true);
  });

  it('an unknown or unplayable id degrades to the first playable level', () => {
    expect(levelOrDefault(undefined).id).toBe('scrapyard');
    expect(levelOrDefault('no-such-level').id).toBe('scrapyard');
    expect(levelOrDefault('mossy-mayhem').id).toBe('mossy-mayhem');
  });
});

describe('the Scrapyard still has a wall', () => {
  it('stops the mech at the fence, whichever way it runs', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const w = world('scrapyard');
      // Comfortably longer than it takes to cross half the yard at 195 u/s.
      run(w, dx, dy, 60 * 80);
      expect(Math.abs(w.player.x)).toBeLessThanOrEqual(ARENA_HALF);
      expect(Math.abs(w.player.y)).toBeLessThanOrEqual(ARENA_HALF);
    }
  });
});

describe('Mossy Mayhem does not', () => {
  it('is unbounded on the level definition', () => {
    expect(world('mossy-mayhem').arenaHalf).toBe(Infinity);
  });

  it('lets the mech run clean past where the fence would be, in all four directions', () => {
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const w = world('mossy-mayhem');
      run(w, dx, dy, 60 * 80);
      const travelled = Math.abs(w.player.x) + Math.abs(w.player.y);
      expect(travelled).toBeGreaterThan(ARENA_HALF);
      expect(Number.isFinite(travelled)).toBe(true);
    }
  });

  it('and diagonally, which is where a per-axis clamp would still bite', () => {
    const w = world('mossy-mayhem');
    run(w, 1, 1, 60 * 80);
    expect(Math.abs(w.player.x)).toBeGreaterThan(ARENA_HALF);
    expect(Math.abs(w.player.y)).toBeGreaterThan(ARENA_HALF);
  });

  it('keeps spawning the horde out there, far outside the old arena', () => {
    // The spawn ring used to be clamped into the arena square. Out past the old wall that clamp
    // would have folded every enemy back toward the origin - or worse, onto the player.
    const w = world('mossy-mayhem');
    run(w, 1, 0, 60 * 80);
    for (let i = 0; i < 60 * 30; i++) run(w, 0, 0, 1);
    expect(w.enemies.count).toBeGreaterThan(0);
    let near = 0;
    for (let d = 0; d < w.enemies.count; d++) {
      const dx = w.enemies.x[d] - w.player.x;
      const dy = w.enemies.y[d] - w.player.y;
      if (Math.hypot(dx, dy) < 1200) near++;
    }
    // The horde is around the PLAYER, not stranded back at the origin.
    expect(near).toBe(w.enemies.count);
  });

  it('carries no scenery yet, and says so rather than generating half a wood', () => {
    expect(world('mossy-mayhem').scenery.count).toBe(0);
    expect(world('scrapyard').scenery.count).toBeGreaterThan(0);
  });
});

describe('still deterministic', () => {
  it('same seed and level, same hash - and the two levels differ', () => {
    const a = world('mossy-mayhem');
    const b = world('mossy-mayhem');
    for (let i = 0; i < 600; i++) {
      stepWorld(a, EMPTY_INPUT);
      stepWorld(b, EMPTY_INPUT);
    }
    expect(hashWorld(a)).toBe(hashWorld(b));

    const yard = world('scrapyard');
    for (let i = 0; i < 600; i++) stepWorld(yard, EMPTY_INPUT);
    expect(hashWorld(yard)).not.toBe(hashWorld(a));
  });
});
