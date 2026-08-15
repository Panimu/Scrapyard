/**
 * FIELD REPAIR - the clock, and the round trip that unlocks it.
 *
 * The ladder is table data and speaks for itself; what is worth pinning is the behaviour a table
 * cannot show: that the clock is a COUNTDOWN rather than a rate, that it holds at full health, and
 * that the unlock needs a genuine round trip rather than merely being hurt.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { HERO_CATALOG } from '../src/core/data/heroes.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { resolvePlayerStats } from '../src/core/data/stats.js';
import { meetsUnlock } from '../src/core/data/unlocks.js';
import { updatePlayerMovement } from '../src/core/systems/playerMovement.js';
import { RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';
import { testRunRecord } from './fixtures.js';

const REPAIR = UPGRADE_CATALOG.findIndex((d) => d.id === 'p-repair');

function world(tier: number): World {
  const w = createWorld({ seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING });
  w.phase = RUN_PHASE_RUNNING;
  w.levelUp.stacks[REPAIR] = tier;
  resolvePlayerStats(HERO_CATALOG[0], w.levelUp.stacks, w.upgradeCatalog, w.player.stats);
  w.player.hp = w.player.stats.maxHp;
  return w;
}

function ticks(w: World, n: number): void {
  for (let i = 0; i < n; i++) updatePlayerMovement(w, DT);
}

describe('the Field Repair ladder', () => {
  it('carries the amounts and intervals it was specified with', () => {
    const want: [number, number][] = [
      [1, 7],
      [2, 7],
      [3, 7],
      [3, 6],
      [4, 6],
      [5, 6],
      [5, 5],
    ];
    for (let t = 1; t <= 7; t++) {
      const s = world(t).player.stats;
      expect([s.repairAmount, s.repairInterval], `tier ${t}`).toEqual(want[t - 1]);
    }
  });

  it('does nothing at all without the card', () => {
    const w = world(0);
    w.player.hp = 10;
    ticks(w, 60 * 30);
    expect(w.player.hp).toBe(10);
  });

  it('repairs its amount once per interval, not continuously', () => {
    const w = world(1); // 1 hp every 7 s
    w.player.hp = 50;

    // Most of an interval: nothing yet. A rate would have paid out about 6 hp by here.
    ticks(w, 60 * 6);
    expect(w.player.hp).toBe(50);

    ticks(w, 60 * 1 + 2);
    expect(w.player.hp).toBe(51);

    // And again, on the next turn of the clock rather than immediately.
    ticks(w, 60 * 6);
    expect(w.player.hp).toBe(51);
    ticks(w, 60 * 1 + 2);
    expect(w.player.hp).toBe(52);
  });

  it('holds the clock at full health, so a hit is always a whole interval from a repair', () => {
    const w = world(7); // 5 hp every 5 s
    ticks(w, 60 * 20); // twenty seconds at full hull
    w.player.hp = w.player.stats.maxHp - 10;

    // Four seconds later: still nothing, because the clock was parked rather than running.
    ticks(w, 60 * 4);
    expect(w.player.hp).toBe(w.player.stats.maxHp - 10);
    ticks(w, 60 * 1 + 2);
    expect(w.player.hp).toBe(w.player.stats.maxHp - 5);
  });

  it('never overheals', () => {
    const w = world(7);
    w.player.hp = w.player.stats.maxHp - 1;
    ticks(w, 60 * 30);
    expect(w.player.hp).toBe(w.player.stats.maxHp);
  });
});

describe('the round trip that unlocks it', () => {
  it('counts a run that fell under a tenth and got all the way back', () => {
    const w = world(0);
    const max = w.player.stats.maxHp;

    w.player.hp = max * 0.05;
    ticks(w, 2);
    expect(w.stats.fullRepairs).toBe(0); // being nearly dead is not the achievement

    w.player.hp = max * 0.9;
    ticks(w, 2);
    expect(w.stats.fullRepairs).toBe(0); // nor is most of the way back

    w.player.hp = max;
    ticks(w, 2);
    expect(w.stats.fullRepairs).toBe(1);

    // The latch is spent: sitting at full does not keep counting.
    ticks(w, 120);
    expect(w.stats.fullRepairs).toBe(1);
  });

  it('does not count a run that was merely hurt and healed', () => {
    const w = world(0);
    const max = w.player.stats.maxHp;
    w.player.hp = max * 0.5; // never under a tenth
    ticks(w, 2);
    w.player.hp = max;
    ticks(w, 2);
    expect(w.stats.fullRepairs).toBe(0);
  });

  it('is what the card asks for', () => {
    const def = UPGRADE_CATALOG[REPAIR];
    expect(def.unlock).toBeDefined();
    const ids = UPGRADE_CATALOG.map((d) => d.id);
    expect(meetsUnlock(def.unlock!, testRunRecord({ fullRepairs: 0 }), ids)).toBe(false);
    expect(meetsUnlock(def.unlock!, testRunRecord({ fullRepairs: 1 }), ids)).toBe(true);
  });
});
