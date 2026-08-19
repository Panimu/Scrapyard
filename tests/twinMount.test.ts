/**
 * THE TWIN MOUNT - the Cannon's tier 8. The second barrel comes back: two full parallel shells
 * straddling the aim line, aimed as their midpoint, never converging.
 *
 * What is pinned: the volley's shape (two shells, parallel, TWIN_HALF_GAP each side, full damage
 * on both - no re-engage discount), that tiers 1-7 still fire the single shell, that both shells
 * can land independently on one wide body, and that the chest gate asks for exactly what the
 * design says: the Cannon finished at seven with Ordnance held at any level.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CANNON,
  TWIN_HALF_GAP,
  WEAPON_CATALOG,
} from '../src/core/content/weaponCatalog.js';
import {
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  WEAPON_MAX_TIER,
  upgradeIndex,
} from '../src/core/data/upgrades.js';
import { resolveWeaponStats } from '../src/core/data/stats.js';
import { ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick } from '../src/core/systems/clock.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { ascensionReady } from '../src/core/systems/progression.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { reapDead } from '../src/core/systems/reap.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

/** A world holding the Cannon at `tier`, stats resolved for real. */
function makeWorld(tier: number, seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    {
      heroes: [testHero({ startingWeapon: 'cannon' })],
      weapons: WEAPON_CATALOG,
      upgrades: UPGRADE_CATALOG,
    },
  );
  w.phase = RUN_PHASE_RUNNING;
  w.levelUp.stacks[upgradeIndex('w-cannon')] = tier;
  const inst = w.weapons[0];
  inst.level = tier;
  resolveWeaponStats(CANNON, w.heroes[0], tier, w.levelUp.stacks, UPGRADE_CATALOG, inst.stats);
  return w;
}

function addEnemy(world: World, x: number, y: number, hp: number, radius = 18): number {
  const e = world.enemies;
  const handle = allocEnemy(e, 0, 0, ARCH_GRUNT, x, y, world.director.nextSpawnId++);
  expect(handle).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = radius;
  e.mass[d] = 1.2;
  e.speed[d] = 0;
  return d;
}

function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  updateProjectiles(world, DT);
  updateCollision(world, DT);
  updateDamage(world, DT);
  reapDead(world);
}

describe('the volley', () => {
  it('fires ONE shell all the way to tier 7', () => {
    const w = makeWorld(WEAPON_MAX_TIER);
    addEnemy(w, 200, 0, 5000, 26);
    tick(w);
    expect(w.projectiles.count).toBe(1);
  });

  it('fires TWO parallel shells at tier 8, straddling the aim line at full damage each', () => {
    const w = makeWorld(WEAPON_ASCENDED_TIER);
    addEnemy(w, 200, 0, 5000, 26);
    tick(w);

    const p = w.projectiles;
    expect(p.count).toBe(2);
    // PARALLEL, NO CONVERGENCE: identical velocities, both on the target's exact bearing (+x).
    expect(p.vx[0]).toBeCloseTo(p.vx[1], 9);
    expect(p.vy[0]).toBeCloseTo(p.vy[1], 9);
    expect(p.vy[0]).toBeCloseTo(0, 9);
    // AIMED AS THE MIDPOINT: one shell TWIN_HALF_GAP each side of the line, muzzle offset ahead.
    const ys = [p.y[0], p.y[1]].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(-TWIN_HALF_GAP, 5);
    expect(ys[1]).toBeCloseTo(TWIN_HALF_GAP, 5);
    // FULL DAMAGE ON BOTH - the second shell is the other barrel, not a re-engage at 0.55.
    const t8damage = CANNON.base.damage + 18; // the one damage tier (T4) on the ladder
    expect(p.damage[0]).toBeCloseTo(t8damage, 5);
    expect(p.damage[1]).toBeCloseTo(t8damage, 5);
  });

  it('lands both shells independently on one wide body centred on the line', () => {
    const w = makeWorld(WEAPON_ASCENDED_TIER);
    // A bruiser-sized body dead ahead: at 8 u off the line against radius 26 + shell 9, both
    // shells connect, each with its own hit record - the centred big target pays for both.
    const target = addEnemy(w, 200, 0, 5000, 26);
    for (let t = 0; t < 40; t++) tick(w);

    const t8damage = CANNON.base.damage + 18;
    expect(w.enemies.hp[target]).toBeCloseTo(5000 - 2 * t8damage, 4);
  });
});

describe('the gate and the catalog', () => {
  it('asks for the Cannon finished at seven with Ordnance held at any level', () => {
    const card = UPGRADE_CATALOG[upgradeIndex('w-cannon')];
    expect(card.ascension?.name).toBe('Twin Mount');
    expect(card.ascension?.requires).toBe('p-damage');
    expect(card.ascension?.requiresTier).toBe(1);
    expect(card.ascension?.consumes).toBeUndefined(); // nothing is eaten - unlike the Hornet
    expect(CANNON.twinFrom).toBe(WEAPON_ASCENDED_TIER);
  });

  it('ascensionReady wants both halves: tier seven AND the passive', () => {
    const w = makeWorld(WEAPON_MAX_TIER);
    const cannonIdx = upgradeIndex('w-cannon');
    const ordnanceIdx = upgradeIndex('p-damage');

    // Cannon at 7, no Ordnance: not ready.
    expect(ascensionReady(w, cannonIdx)).toBe(false);
    // Ordnance at tier 1 is enough - "any level" is the design.
    w.levelUp.stacks[ordnanceIdx] = 1;
    expect(ascensionReady(w, cannonIdx)).toBe(true);
    // And the Cannon short of seven is not ready however much Ordnance is held.
    w.levelUp.stacks[cannonIdx] = 6;
    expect(ascensionReady(w, cannonIdx)).toBe(false);
  });
});
