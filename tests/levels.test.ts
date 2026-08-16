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
import { SPAWNABLE_ARCHETYPES, createResolvedCycle, maxEnemySpeedAt } from '../src/core/content/cycles.js';
import { stageIndexFor } from '../src/render/creatureArt.js';

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

/**
 * EACH LEVEL OWNS ITS ENEMIES, and the point of the split is that editing one cannot reach the
 * other. These check the seams that make that true rather than restating the tables.
 */
describe('a level owns its creatures', () => {
  it('no creature object is shared between levels', () => {
    // Identity, not equality. Two levels may legitimately choose the same drawSize; what must
    // never happen is one level's row BEING another's, because then a tweak lands on both.
    const seen = new Set<unknown>();
    for (const level of LEVEL_CATALOG) {
      for (const c of level.creatures) {
        expect(seen.has(c)).toBe(false);
        seen.add(c);
      }
    }
  });

  it('creature ids are positional, so a cycle can never name its neighbour', () => {
    for (const level of LEVEL_CATALOG) {
      level.creatures.forEach((c, i) => expect(c.id).toBe(i));
    }
  });

  it('every rank of every authored cycle resolves to a real creature', () => {
    for (const level of LEVEL_CATALOG) {
      const c = createResolvedCycle(level.resolveCycle);
      // Past the authored ladder too: extrapolation must not walk off the end of the table.
      for (let i = 0; i < 24; i++) {
        level.resolveCycle(i, c);
        for (const typeId of c.typeByRank) {
          expect(level.creatures[typeId]).toBeDefined();
        }
      }
    }
  });

  it('every cycle uses a body class MAX_ENEMY_RADIUS actually bounds', () => {
    // MAX_ENEMY_RADIUS is derived from SPAWNABLE_ARCHETYPES rather than from the ladders, so that
    // adding a level cannot silently widen a bound four spatial queries depend on. This is the
    // check that keeps that honest - it fails the level, not the queries.
    for (const level of LEVEL_CATALOG) {
      const c = createResolvedCycle(level.resolveCycle);
      for (let i = 0; i < 24; i++) {
        level.resolveCycle(i, c);
        expect(SPAWNABLE_ARCHETYPES).toContain(c.archetype);
      }
    }
  });

  it('Invariant K holds on every level, not just the one it was measured on', () => {
    // Every hero must out-run the fastest thing the ladder can produce, or kiting stops working
    // and the genre goes with it. tests/movement.test.ts checks it against the Scrapyard; this
    // checks that adding a level did not quietly break it somewhere else.
    const d = DEFAULT_TUNING.director;
    let ramp = 1;
    for (let s = 0; s < d.cycleSeconds; s++) ramp *= d.speedRampPerSec;

    // The slowest mech in the game, resolved through the real stat pipeline rather than guessed.
    let slowest = Infinity;
    for (let heroId = 0; heroId < 8; heroId++) {
      const w = createWorld({ seed: 1, heroId, runLengthSec: 900, tuning: DEFAULT_TUNING });
      if (w.player.stats.moveMaxSpeed < slowest) slowest = w.player.stats.moveMaxSpeed;
    }

    for (const level of LEVEL_CATALOG) {
      for (let i = 0; i < 12; i++) {
        expect(slowest).toBeGreaterThanOrEqual(1.08 * maxEnemySpeedAt(level.resolveCycle, i, ramp));
      }
    }
  });
});

describe('damage stages', () => {
  it('splits a health bar into even bands, healthiest first', () => {
    // Two frames break at exactly half - one event in the fight, which is what a snail losing its
    // shell should be.
    expect(stageIndexFor(1, 1, 2)).toBe(0);
    expect(stageIndexFor(0.6, 1, 2)).toBe(0);
    expect(stageIndexFor(0.4, 1, 2)).toBe(1);
    // Five frames turn a hydra's bar into a countdown of heads.
    expect(stageIndexFor(1, 1, 5)).toBe(0);
    expect(stageIndexFor(0.5, 1, 5)).toBe(2);
    expect(stageIndexFor(0.01, 1, 5)).toBe(4);
  });

  it('clamps rather than trusting hp, which is briefly out of range at the killing blow', () => {
    expect(stageIndexFor(0, 1, 5)).toBe(4);
    expect(stageIndexFor(-30, 1, 5)).toBe(4);
    expect(stageIndexFor(2, 1, 5)).toBe(0);
    // A one-frame creature is every creature that does not come apart. It never indexes anything.
    expect(stageIndexFor(0, 1, 1)).toBe(0);
    expect(stageIndexFor(1, 0, 3)).toBe(0);
  });
});
