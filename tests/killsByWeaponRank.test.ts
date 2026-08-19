/**
 * WHO FINISHED WHAT, BY RANK - RunStats.killsByWeaponRank.
 *
 * The array carries the same kills `killsByWeapon` already counts, split by the rank of the body
 * that went down. Two counters over one event is a real risk and the reason this file exists: the
 * moment they can disagree, one of them is lying and nothing says which. So the contract is pinned
 * rather than assumed - the row sum IS the total, for every weapon, after a real fight.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { RANKS, RANK_BOSS, RANK_ELITE, RANK_REGULAR } from '../src/core/content/cycles.js';
import { WEAPON_CATALOG, weaponDefIndex } from '../src/core/content/weaponCatalog.js';
import { allocEnemy, ENEMY_FLAG_BOSS, ENEMY_FLAG_ELITE } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';
import { reapDead } from '../src/core/systems/reap.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

const ARCH_GRUNT = 1;

function makeWorld(): World {
  const w = createWorld(
    { seed: 4, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    { heroes: [testHero({ startingWeapon: 'laser-short' })], weapons: WEAPON_CATALOG, upgrades: [] },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** One body at `x`, with the flags that make it an elite or a boss. */
function addEnemy(world: World, x: number, hp: number, flags = 0): number {
  const e = world.enemies;
  expect(allocEnemy(e, 0, 0, ARCH_GRUNT, x, 0, world.director.nextSpawnId++)).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = 18;
  e.mass[d] = 1.2;
  e.speed[d] = 0;
  e.flags[d] |= flags;
  return d;
}

function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  updateProjectiles(world, DT);
  updateDamage(world, DT);
  reapDead(world);
  endTick(world);
}

describe('kills by weapon and rank', () => {
  it('files each killing blow under the rank of the body that went down', () => {
    const w = makeWorld();
    const laser = weaponDefIndex('laser-short');
    const at = (rank: number): number => w.stats.killsByWeaponRank[laser * RANKS.length + rank];

    // Three bodies, one of each rank, killed one after another by the one gun held. Weak enough
    // that the beam finishes each in a few ticks.
    addEnemy(w, 80, 4);
    for (let t = 0; t < 40 && w.stats.kills < 1; t++) tick(w);
    expect(at(RANK_REGULAR)).toBe(1);
    expect(at(RANK_ELITE)).toBe(0);
    expect(at(RANK_BOSS)).toBe(0);

    addEnemy(w, 80, 4, ENEMY_FLAG_ELITE);
    for (let t = 0; t < 40 && w.stats.kills < 2; t++) tick(w);
    expect(at(RANK_ELITE)).toBe(1);

    addEnemy(w, 80, 4, ENEMY_FLAG_BOSS);
    for (let t = 0; t < 40 && w.stats.kills < 3; t++) tick(w);
    expect(at(RANK_BOSS)).toBe(1);

    // BOSS OUTRANKS ELITE when a body somehow carries both, matching killEnemy's own ladder - a
    // boss flagged elite is a boss, and must not be counted twice.
    addEnemy(w, 80, 4, ENEMY_FLAG_BOSS | ENEMY_FLAG_ELITE);
    for (let t = 0; t < 40 && w.stats.kills < 4; t++) tick(w);
    expect(at(RANK_BOSS)).toBe(2);
    expect(at(RANK_ELITE)).toBe(1);
  });

  it('sums to killsByWeapon exactly - the two counters can never disagree', () => {
    const w = makeWorld();
    for (let i = 0; i < 12; i++) {
      addEnemy(w, 60 + (i % 3) * 20, 3, i % 4 === 0 ? ENEMY_FLAG_ELITE : i % 7 === 0 ? ENEMY_FLAG_BOSS : 0);
    }
    for (let t = 0; t < 900; t++) tick(w);
    expect(w.stats.kills).toBeGreaterThan(0);

    // THE CONTRACT: for every weapon, the rank row sums to the flat total. Checked across the
    // whole catalog rather than the one gun held, so a stray increment filed under the wrong
    // weapon index fails here too.
    for (let d = 0; d < WEAPON_CATALOG.length; d++) {
      let row = 0;
      for (let r = 0; r < RANKS.length; r++) row += w.stats.killsByWeaponRank[d * RANKS.length + r];
      expect(row, WEAPON_CATALOG[d].name).toBe(w.stats.killsByWeapon[d]);
    }
  });

  it('agrees with the run-wide killsByRank on the ranks a weapon finished', () => {
    // killsByRank counts every death; killsByWeaponRank counts only those a WEAPON finished. With
    // no shield backlash in this fixture the two must match rank for rank - and when they ever do
    // not, the difference is exactly the kills credited to nothing.
    const w = makeWorld();
    for (let i = 0; i < 8; i++) addEnemy(w, 70, 3, i % 3 === 0 ? ENEMY_FLAG_ELITE : 0);
    for (let t = 0; t < 900; t++) tick(w);

    for (let r = 0; r < RANKS.length; r++) {
      let byWeapon = 0;
      for (let d = 0; d < WEAPON_CATALOG.length; d++) {
        byWeapon += w.stats.killsByWeaponRank[d * RANKS.length + r];
      }
      expect(byWeapon, RANKS[r].name).toBe(w.stats.killsByRank[r]);
    }
  });
});
