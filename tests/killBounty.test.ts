/**
 * THE KILL BOUNTY - credits paid for an elite or a boss going down.
 *
 * The only credits in the game that are not walked over. Everything else in `RunStats.credits`
 * arrives as a blue coin the player crossed, so this is the one path where the number moves with
 * nothing on the ground to show for it - which is exactly why it needs pinning here.
 *
 * IT IS NOT COVERED BY THE CORPUS, and that is not an oversight to fix by adding a run. The nine
 * golden runs hash the world, and `stats.credits` does not reach that hash - a boss dying pays the
 * bounty without moving a single checkpoint. So the corpus would go on passing if the whole thing
 * were deleted, and this file is the only thing standing between that and a silent regression.
 *
 * ASSERTED AGAINST THE TUNING, never against 1 and 5. A test that repeated the numbers would have
 * to be edited every time they were balanced, and an assertion you have to edit to make a change
 * is an assertion that stops being read.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
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
const { creditPerElite, creditPerBoss } = DEFAULT_TUNING.pickups;

function makeWorld(): World {
  const w = createWorld(
    { seed: 4, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    { heroes: [testHero({ startingWeapon: 'laser-short' })], weapons: WEAPON_CATALOG, upgrades: [] },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** One body at `x`, with the flags that make it an elite or a boss. */
function addEnemy(world: World, x: number, hp: number, flags = 0): void {
  const e = world.enemies;
  expect(allocEnemy(e, 0, 0, ARCH_GRUNT, x, 0, world.director.nextSpawnId++)).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = 18;
  e.mass[d] = 1.2;
  e.speed[d] = 0;
  e.flags[d] |= flags;
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

/** Kills one body of the given flags and reports what the bounty paid for it. */
function creditsFor(world: World, flags: number): number {
  const before = world.stats.credits;
  const want = world.stats.kills + 1;
  addEnemy(world, 80, 4, flags);
  for (let t = 0; t < 40 && world.stats.kills < want; t++) tick(world);
  expect(world.stats.kills).toBe(want);
  return world.stats.credits - before;
}

describe('the kill bounty', () => {
  it('pays for an elite and a boss, and nothing for a regular', () => {
    const w = makeWorld();

    // THE HORDE IS THE BACKGROUND. A per-body trickle from the one rank there are thousands of
    // would drown the other two in noise, so a regular is worth nothing at all.
    expect(creditsFor(w, 0)).toBe(0);
    expect(creditsFor(w, ENEMY_FLAG_ELITE)).toBe(creditPerElite);
    expect(creditsFor(w, ENEMY_FLAG_BOSS)).toBe(creditPerBoss);
  });

  it('pays a boss rate, once, for a body flagged as both', () => {
    const w = makeWorld();

    // BOSS OUTRANKS ELITE, matching killEnemy's own ladder.
    //
    // WHAT THIS DOES NOT TEST, since it was written believing otherwise: it is not a guard on the
    // `if/else if` in the bounty. `rank` is a single value off a ladder that already puts boss
    // above elite, so swapping that else for a second `if` changes nothing and this still passes -
    // checked, by making exactly that edit. What it pins is the LADDER: a body carrying both flags
    // resolves to boss, and the day someone reorders those ternaries this is what notices.
    expect(creditsFor(w, ENEMY_FLAG_BOSS | ENEMY_FLAG_ELITE)).toBe(creditPerBoss);
  });

  it('accumulates across a fight rather than tracking the last kill', () => {
    const w = makeWorld();

    creditsFor(w, ENEMY_FLAG_ELITE);
    creditsFor(w, ENEMY_FLAG_ELITE);
    creditsFor(w, ENEMY_FLAG_BOSS);
    expect(w.stats.credits).toBe(creditPerElite * 2 + creditPerBoss);
  });
});
