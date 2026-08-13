/**
 * S2 updateSpawning - the 120-second cycle director.
 *
 * These tests assert the SCHEDULE and the STRUCTURE, never the balance numbers. Cycle HP, speed
 * and the rank multipliers are expected to move every playtest; "exactly one boss per cycle" and
 * "an elite is a recolour of the regular's own hull" are the contract. Every expectation below is
 * therefore derived from the catalog rather than typed in, so a retune cannot turn this file red.
 *
 * The world is stepped through the REAL pipeline (`stepWorld`) rather than by calling
 * `updateSpawning` directly: the phase gate, the runSec clock and reapDead all participate in
 * what the director sees, and a spawner tested in isolation would pass while the game spawned
 * nothing.
 */

import { describe, expect, it } from 'vitest';

import { DT } from '../src/core/constants.js';
import {
  DEFAULT_TUNING,
  cycleIndexAt,
  cyclePhaseAt,
  cycleTimeAt,
} from '../src/core/config/tuning.js';
import {
  CYCLE_LADDER,
  MAX_ENEMY_RADIUS,
  MAX_RANK_SIZE,
  RANKS,
  RANK_BOSS,
  RANK_ELITE,
  RANK_REGULAR,
  createResolvedCycle,
  resolveCycle,
  typeIdFor,
} from '../src/core/content/cycles.js';
import { ARCHETYPES, ENEMY_CATALOG } from '../src/core/content/enemyCatalog.js';
import {
  ENEMY_FLAG_BOSS,
  ENEMY_FLAG_DEAD,
  ENEMY_FLAG_ELITE,
} from '../src/core/entity/enemyPool.js';
import { RUN_PHASE_LEVEL_UP, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

const T = DEFAULT_TUNING.director;

/** A world already past the intro, with an unkillable pilot - survival is not under test here. */
function makeWorld(seed = 1): World {
  const w = createWorld({ seed, heroId: 0, runLengthSec: 3600, tuning: DEFAULT_TUNING });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/**
 * Steps `sec` of simulation, holding the stick still and pinning the player alive.
 *
 * IT MUST TAKE THE LEVEL-UP CARD. `runSec` freezes while one is open (time spent choosing is not
 * time survived), so a loop that fed a blank frame would stall the cycle clock at whatever second
 * the first gem landed on - and every schedule assertion below would pass vacuously by never
 * reaching the phase it was testing.
 */
const FRAME = { moveX: 0, moveY: 0, buttons: 0, chooseIndex: -1 };
function run(w: World, sec: number, onTick?: (w: World) => void): void {
  const ticks = Math.round(sec / DT);
  for (let i = 0; i < ticks; i++) {
    w.player.hp = w.player.stats.maxHp;
    FRAME.chooseIndex = w.phase === RUN_PHASE_LEVEL_UP ? 0 : -1;
    stepWorld(w, FRAME);
    onTick?.(w);
  }
}

function rankOf(flags: number): number {
  if ((flags & ENEMY_FLAG_BOSS) !== 0) return RANK_BOSS;
  if ((flags & ENEMY_FLAG_ELITE) !== 0) return RANK_ELITE;
  return RANK_REGULAR;
}

/** Live count by rank, right now. */
function census(w: World): [number, number, number] {
  const out: [number, number, number] = [0, 0, 0];
  const p = w.enemies;
  for (let d = 0; d < p.count; d++) {
    if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
    out[rankOf(p.flags[d])]++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------

describe('the cycle clock', () => {
  it('splits every cycle into regulars / +elites / +boss at the authored offsets', () => {
    const c = T.cycleSeconds;
    for (let i = 0; i < 4; i++) {
      const base = i * c;
      expect(cycleIndexAt(base)).toBe(i);
      expect(cycleIndexAt(base + c - DT)).toBe(i);
      expect(cycleTimeAt(base + 7)).toBeCloseTo(7, 9);

      expect(cyclePhaseAt(base)).toBe(0);
      expect(cyclePhaseAt(base + T.eliteFromSec - DT)).toBe(0);
      expect(cyclePhaseAt(base + T.eliteFromSec)).toBe(1);
      expect(cyclePhaseAt(base + T.bossFromSec - DT)).toBe(1);
      expect(cyclePhaseAt(base + T.bossFromSec)).toBe(2);
    }
  });

  it('never reports a negative cycle, however the clock is poked', () => {
    expect(cycleIndexAt(-5)).toBe(0);
    expect(cycleIndexAt(0)).toBe(0);
  });
});

describe('rank as a colour swap', () => {
  it('gives every rank the SAME hull in a DIFFERENT faction recolour', () => {
    const c = createResolvedCycle();
    for (let i = 0; i < CYCLE_LADDER.length + 3; i++) {
      resolveCycle(i, c);
      const ids = [
        c.typeByRank[RANK_REGULAR],
        c.typeByRank[RANK_ELITE],
        c.typeByRank[RANK_BOSS],
      ];
      const hulls = new Set(ids.map((id) => ENEMY_CATALOG[id].hull));
      const tiers = new Set(ids.map((id) => ENEMY_CATALOG[id].tier));
      expect(hulls.size).toBe(1); // one silhouette
      expect(tiers.size).toBe(3); // three paint jobs
      // The body class follows the hull, so all three ranks share it.
      for (const id of ids) expect(ENEMY_CATALOG[id].archetype).toBe(c.archetype);
    }
  });

  it('derives the body class from the hull rather than authoring it twice', () => {
    const c = createResolvedCycle();
    for (let i = 0; i < CYCLE_LADDER.length; i++) {
      resolveCycle(i, c);
      expect(c.archetype).toBe(ENEMY_CATALOG[typeIdFor(CYCLE_LADDER[i].hull, 0)].archetype);
    }
  });

  it('moves HP and XP up while moving speed down, at every rank', () => {
    for (let r = 1; r < RANKS.length; r++) {
      expect(RANKS[r].hp).toBeGreaterThan(RANKS[r - 1].hp);
      expect(RANKS[r].xp).toBeGreaterThan(RANKS[r - 1].xp);
      expect(RANKS[r].speed).toBeLessThan(RANKS[r - 1].speed);
      expect(RANKS[r].size).toBeGreaterThan(RANKS[r - 1].size);
    }
    // MAX_RANK_SIZE sizes MAX_ENEMY_RADIUS, so it must actually bound the table.
    for (const r of RANKS) expect(r.size).toBeLessThanOrEqual(MAX_RANK_SIZE);
  });

  it('bounds every spawnable collision radius by MAX_ENEMY_RADIUS', () => {
    // The spatial queries dilate by exactly this. A body that exceeds it is a shell that passes
    // through an enemy, which is the one bug class the hash cannot report.
    for (const def of CYCLE_LADDER) {
      const a = ARCHETYPES[ENEMY_CATALOG[typeIdFor(def.hull, 0)].archetype];
      for (const r of RANKS) {
        expect(a.radius * r.size).toBeLessThanOrEqual(MAX_ENEMY_RADIUS + 1e-9);
      }
    }
  });

  it('extrapolates past the authored ladder instead of falling off the end', () => {
    const c = createResolvedCycle();
    resolveCycle(CYCLE_LADDER.length - 1, c);
    const lastHp = c.hp;
    resolveCycle(CYCLE_LADDER.length + 4, c);
    expect(c.hp).toBeGreaterThan(lastHp);
    expect(Number.isFinite(c.hp)).toBe(true);
    expect(c.typeByRank[RANK_REGULAR]).toBeGreaterThanOrEqual(0);
    expect(c.typeByRank[RANK_BOSS]).toBeLessThan(ENEMY_CATALOG.length);
  });
});

describe('the schedule, as simulated', () => {
  it('spawns ONE creature and nothing else for the whole of phase 0', () => {
    const w = makeWorld();
    const regularType = w.director.cycle.typeByRank[RANK_REGULAR];

    run(w, T.eliteFromSec - 1, (world) => {
      const p = world.enemies;
      for (let d = 0; d < p.count; d++) {
        if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        expect(rankOf(p.flags[d])).toBe(RANK_REGULAR);
        expect(p.typeId[d]).toBe(regularType);
      }
    });

    expect(census(w)[RANK_REGULAR]).toBeGreaterThan(0);
    // Cycle 0 authors variantChance 0: "one simple enemy" means literally one, not usually one.
    expect(CYCLE_LADDER[0].variantChance).toBe(0);
    const p = w.enemies;
    for (let d = 0; d < p.count; d++) {
      if ((p.flags[d] & ENEMY_FLAG_DEAD) === 0) expect(p.flavourId[d]).toBe(0);
    }
  });

  it('adds elites in phase 1 and exactly one boss in phase 2', () => {
    const w = makeWorld(3);

    run(w, T.eliteFromSec);
    expect(census(w)[RANK_ELITE]).toBe(0); // the phase has only just opened
    expect(census(w)[RANK_BOSS]).toBe(0);

    run(w, T.bossFromSec - T.eliteFromSec - 1);
    expect(census(w)[RANK_ELITE]).toBeGreaterThan(0);
    expect(w.director.bossSpawned).toBe(0);

    run(w, T.cycleSeconds - T.bossFromSec + 1);
    expect(w.director.bossSpawned).toBe(1);
    expect(w.director.bossCycle).toBe(0);
  });

  it('produces exactly one boss per cycle, over several cycles', () => {
    const w = makeWorld(9);
    const bossesAtCycleEnd: number[] = [];
    for (let c = 0; c < 4; c++) {
      run(w, T.cycleSeconds);
      bossesAtCycleEnd.push(w.director.bossSpawned);
    }
    expect(bossesAtCycleEnd).toEqual([1, 2, 3, 4]);
  });

  it('leaves the previous cycle\'s enemies alone at a rollover', () => {
    const w = makeWorld(11);
    // DISARMED. This is a claim about the DIRECTOR - that a rollover does not cull or restyle the
    // enemies already standing - and the player's gun is only noise in it. With a weapon fitted
    // the test silently depends on the chassis killing slowly enough to leave survivors, which is
    // a balance number: a 10% range increase on the Medium Laser was enough to clear the field
    // and fail it.
    w.weaponCount = 0;
    run(w, T.cycleSeconds - 2);

    // Snapshot every live enemy's identity. A rollover must not cull, retint or restat one.
    const p = w.enemies;
    const before = new Map<number, number>();
    for (let d = 0; d < p.count; d++) {
      if ((p.flags[d] & ENEMY_FLAG_DEAD) === 0) before.set(p.spawnId[d], p.typeId[d]);
    }
    expect(before.size).toBeGreaterThan(0);

    // Step just past the boundary - short enough that nothing can have walked 900 u away.
    run(w, 4);
    expect(w.director.cycleIndex).toBe(1);

    let survivors = 0;
    for (let d = 0; d < p.count; d++) {
      if ((p.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
      const was = before.get(p.spawnId[d]);
      if (was !== undefined) {
        expect(p.typeId[d]).toBe(was); // same creature, not restyled into the new cycle's
        survivors++;
      }
    }
    expect(survivors).toBeGreaterThan(0);
  });

  it('holds live pressure near the target rather than a headcount', () => {
    const w = makeWorld(5);
    run(w, T.eliteFromSec - 5);

    const d = w.director;
    expect(d.targetPressure).toBeCloseTo(T.pressureBase, 9);
    // The drip stops AT the target and the clamp stops it overshooting by more than one spawn.
    expect(d.localPressure).toBeGreaterThan(T.pressureBase * 0.6);
    expect(d.localPressure).toBeLessThanOrEqual(T.pressureBase + RANKS[RANK_REGULAR].pressure);
  });

  it('caps concurrent elites', () => {
    const w = makeWorld(13);
    let peak = 0;
    run(w, T.cycleSeconds * 2, (world) => {
      const n = census(world)[RANK_ELITE];
      if (n > peak) peak = n;
    });
    expect(peak).toBeGreaterThan(0);
    // One over the cap is reachable: the gate is checked before the spawn, not after.
    expect(peak).toBeLessThanOrEqual(T.maxLiveElites + 1);
  });
});

describe('the within-cycle ramp', () => {
  it('hardens across a cycle and resets at the rollover', () => {
    const w = makeWorld(17);

    run(w, T.cycleSeconds - 2);
    const peak = w.difficulty.hpRamp;
    expect(peak).toBeGreaterThan(1);

    run(w, 3);
    expect(w.director.cycleIndex).toBe(1);
    // Back to the floor, plus at most a second or two of fresh growth. The reset is the whole
    // point: without it this would read `peak` and keep climbing for the rest of the run.
    expect(w.difficulty.hpRamp).toBeGreaterThanOrEqual(1);
    expect(w.difficulty.hpRamp).toBeLessThan(1 + (peak - 1) * 0.1);
  });

  it('reaches the authored total by the end of a cycle', () => {
    let expected = 1;
    for (let s = 0; s < T.cycleSeconds; s++) expected *= T.hpRampPerSec;

    const w = makeWorld(19);
    run(w, T.cycleSeconds - DT);
    // One second short of the boundary, so the last multiply has not landed yet.
    expect(w.difficulty.hpRamp).toBeGreaterThan(expected * 0.99);
    expect(w.difficulty.hpRamp).toBeLessThanOrEqual(expected);
  });
});
