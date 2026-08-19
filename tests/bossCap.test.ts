/**
 * EIGHT BOSSES, AND THEN NO MORE.
 *
 * The ladder extrapolates past its authored table - that is what stops a long run ending in an
 * index error - and the boss used to extrapolate with it. A run that went past sixteen minutes was
 * handed a fresh Scraplord every two minutes on top of however many were still standing, and since
 * bosses are tenants and nothing culls them, the field could only ever get heavier. The win
 * condition is "the timer has passed and no Scraplord is alive", so an endless supply of them is
 * an unfinishable run.
 *
 * Pinned because the failure is invisible in a normal game: the eighth boss arrives at 15:30 and a
 * 15-minute run is usually over before the ninth would have, so nothing short of a long run shows
 * it - and a long run is exactly the case this rule exists for.
 */

import { describe, expect, it } from 'vitest';

import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { ENEMY_FLAG_BOSS, markEnemyDead } from '../src/core/entity/enemyPool.js';
import { LEVEL_CATALOG } from '../src/core/content/levels.js';
import { stepWorld } from '../src/core/index.js';
import { createWorld } from '../src/core/world.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';

/**
 * THE PILOT FLIES A SLOW CIRCLE, and every simpler stick was measured and rejected.
 *
 * A boss retries its allocation only while its phase lasts - thirty seconds - and loses the cycle if
 * it cannot place in that window. Both degenerate pilots hit that, for opposite reasons:
 *
 *   STANDING STILL breaks Mossy Mayhem. The spawn ring never moves, and if the wall lattice happens
 *   to cover it the boss has nowhere to appear. Measured: 2 bosses in nineteen minutes, not 8.
 *   HOLDING ONE DIRECTION breaks the Scrapyard. Nineteen minutes of it parks the mech in the fence
 *   corner with half the ring outside the arena. Measured: 2 again.
 *
 * A circle keeps the mech in open ground on both maps, which is what a player does. `Math.sin` is
 * fine here - this is a test, not core.
 */
function stickAt(tick: number): { moveX: number; moveY: number; buttons: number; chooseIndex: number } {
  const a = tick / 300;
  return {
    moveX: Math.round(127 * Math.cos(a)),
    moveY: Math.round(127 * Math.sin(a)),
    buttons: 0,
    chooseIndex: 0,
  };
}

/**
 * PINNED EVERY TICK, not once at the start, and that is the whole trick.
 *
 * Setting the multiplier on a fresh world is not enough: anything that applies an upgrade
 * re-resolves the player's stats from base, which puts the multiplier back to 1. Zeroing `xpGain`
 * closes the level-up route but not the Cyber Chest, so a run that picks one up stops being
 * immortal - measured on Mossy Mayhem, the mech takes its first real damage at 3:52 and is dead by
 * minute 12, a long way short of the extrapolated cycles this file exists to reach.
 */
function pin(w: World): void {
  w.player.stats.damageTakenMul = 0;
  w.player.stats.xpGain = 0;
}

function immortal(levelId: string): World {
  const w = createWorld({
    seed: 3, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId,
  });
  w.phase = RUN_PHASE_RUNNING;
  pin(w);
  w.player.hp = w.player.stats.maxHp;
  return w;
}

/**
 * Runs to `sec`, clearing the CHAFF every second and leaving the bosses standing.
 *
 * Both halves are needed. Clearing chaff stops the pool reaching MAX_LIVE_ENEMIES, which it does by
 * minute 15 against an immortal pilot with no guns - and a full pool refuses the boss allocation, so
 * the test would pass for the wrong reason. Leaving the bosses alive stops the run being WON at the
 * timer, which is the only way it reaches the extrapolated cycles at all.
 */
function runTo(w: World, sec: number, from = 0): void {
  for (let t = 1; t <= 60 * sec; t++) {
    pin(w);
    stepWorld(w, stickAt(from * 60 + t));
    if (t % 60 !== 0) continue;
    for (let d = 0; d < w.enemies.count; d++) {
      if ((w.enemies.flags[d] & ENEMY_FLAG_BOSS) === 0) markEnemyDead(w.enemies, d);
    }
  }
}

describe('the boss supply', () => {
  // Nineteen simulated minutes apiece, which is a few seconds of real time and well past vitest's
  // 5 s default.
  it('stops at the last authored cycle', () => {
    const w = immortal('scrapyard');
    const authored = w.level.cycleCount;
    expect(authored).toBe(8);

    // 15:31 - one tick past the eighth boss's arrival, which is cycle 7 at bossFromSec.
    runTo(w, 931);
    expect(w.director.bossSpawned, 'the eighth boss should be in by 15:31').toBe(authored);

    // Three more extrapolated cycles. They still bring regulars and elites; they bring no boss.
    runTo(w, 1140 - 931, 931);
    expect(w.director.cycleIndex, 'should be well past the authored table').toBeGreaterThan(authored);
    expect(w.director.bossSpawned, 'an extrapolated cycle spawned a boss').toBe(authored);
  }, 60_000);

  /**
   * EVERY LEVEL, and exactly its own count rather than "no more than".
   *
   * A ladder authors `cycleCount` bosses and a nineteen-minute run should collect all of them, so
   * the assertion is equality: too many means the extrapolated cycles are still handing them out,
   * and too FEW means a boss failed to place - it retries only for the thirty seconds its phase
   * lasts, and on Mossy Mayhem the wall lattice can cover the spawn ring. Both are worth a failure,
   * and a one-sided bound would only ever catch one of them.
   */
  it('delivers exactly what a ladder authors, on any level', () => {
    // PLAYABLE ONLY: a stub has no ladder to author bosses with, and asking it for one throws by
    // design - see levelCityChaos.ts.
    for (const level of LEVEL_CATALOG.filter((l) => l.playable)) {
      const w = immortal(level.id);
      runTo(w, 1140);
      expect(w.director.cycleIndex, `${level.id} never reached an extrapolated cycle`)
        .toBeGreaterThan(level.cycleCount);
      expect(
        w.director.bossSpawned,
        `${level.id} did not spawn exactly the bosses its ladder authors`,
      ).toBe(level.cycleCount);
    }
  }, 60_000);
});
