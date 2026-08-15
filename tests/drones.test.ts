/**
 * Drones. The first thing in this game that is neither a shell nor a beam, and the only weapon
 * whose output has a mind of its own - so the parts worth pinning are the ones a balance pass
 * cannot see: does it go, does it come back, does it die when it should.
 *
 * THE STAGES ARE RUN BY HAND rather than through `stepWorld`, the way the laser suite does it.
 * `stepWorld` also runs the spawner, and the spawner does not care that this fixture asked for an
 * empty enemy catalog - it builds bodies from ARCHETYPES. A test about which body a drone chose is
 * worthless if the horde is quietly adding others.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';
import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { UPGRADE_CATALOG } from '../src/core/data/upgrades.js';
import { WEAPON_CATALOG, DRONE, MACHINE_GUN } from '../src/core/content/weaponCatalog.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { DRONE_STATE_ENGAGE, DRONE_STATE_ESCORT } from '../src/core/entity/dronePool.js';
import { updateDrones } from '../src/core/systems/drones.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { beginTick, createWorld, endTick, reapDead } from '../src/core/world.js';

const ARCH_GRUNT = 1;

function droneWorld(): World {
  const w = createWorld(
    { seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    {
      heroes: [testHero({ startingWeapon: 'drone' })],
      enemies: [],
      weapons: WEAPON_CATALOG,
      upgrades: UPGRADE_CATALOG,
    },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Everything a drone touches, in pipeline order. No spawner - see the file header. */
function tick(w: World): void {
  beginTick(w, EMPTY_INPUT);
  rebuildSpatialHash(w.spatial, w.enemies);
  updateDrones(w, DT);
  updateProjectiles(w, DT);
  updateCollision(w, DT);
  updateDamage(w, DT);
  reapDead(w);
  endTick(w);
}

function ticks(w: World, n: number): void {
  for (let i = 0; i < n; i++) tick(w);
}

function addEnemy(w: World, x: number, y: number, hp: number): number {
  const handle = allocEnemy(w.enemies, 0, 0, ARCH_GRUNT, x, y, ++w.director.nextSpawnId);
  expect(handle).not.toBe(NULL_HANDLE);
  const d = w.enemies.count - 1;
  w.enemies.hp[d] = hp;
  w.enemies.maxHp[d] = hp;
  w.enemies.radius[d] = 14;
  w.enemies.mass[d] = 1.2;
  w.enemies.speed[d] = 0;
  return d;
}

const dist = (ax: number, ay: number, bx: number, by: number): number =>
  Math.hypot(ax - bx, ay - by);

describe('the drone bay', () => {
  it('deploys its first drone immediately and its next on the build timer', () => {
    const w = droneWorld();
    tick(w);
    expect(w.drones.count).toBe(1);
    // Loaded from the GUN's magazine, not the bay's - the bay carries no ammo at all, and reading
    // it from there launched drones with one round that detonated on their first shot.
    expect(w.drones.ammo[0]).toBe(MACHINE_GUN.base.ammoCapacity);
    expect(w.weapons[0].cooldownLeft).toBeCloseTo(DRONE.base.cooldown, 5);
  });

  it('holds at the tier cap and banks exactly one, then deploys it the moment there is room', () => {
    const w = droneWorld();
    ticks(w, 2);
    expect(w.drones.count).toBe(1); // tier 1 caps at one

    // Long enough for two more builds to finish. Only one may be banked.
    ticks(w, Math.ceil(DRONE.base.cooldown / DT) * 2 + 10);
    expect(w.drones.count).toBe(1);
    expect(w.weapons[0].droneBanked).toBe(true);

    // Lose the drone: the reserve takes its place on the very next tick, not thirty seconds later.
    w.drones.count = 0;
    tick(w);
    expect(w.drones.count).toBe(1);
    expect(w.weapons[0].droneBanked).toBe(false);
  });

  it('escorts the player when there is nothing to shoot', () => {
    const w = droneWorld();
    ticks(w, 200);
    expect(w.drones.state[0]).toBe(DRONE_STATE_ESCORT);
    expect(w.drones.targetDense[0]).toBe(-1);
    // Circling, not sitting on the mech.
    const r = dist(w.drones.x[0], w.drones.y[0], w.player.x, w.player.y);
    expect(r).toBeGreaterThan(30);
    expect(r).toBeLessThan(90);
  });

  it('leaves the player to circle a body inside twice its reach, and shoots it', () => {
    const w = droneWorld();
    ticks(w, 60);
    // Inside 2x the Machine Gun's 130, and far outside the escort ring.
    const e = addEnemy(w, 220, 0, 1_000_000);
    ticks(w, 240);

    expect(w.drones.state[0]).toBe(DRONE_STATE_ENGAGE);
    expect(w.drones.targetDense[0]).toBe(e);
    // It went there. Circling at roughly the engage radius rather than sitting on top of it.
    expect(dist(w.drones.x[0], w.drones.y[0], 220, 0)).toBeLessThan(110);
    expect(w.drones.ammo[0]).toBeLessThan(MACHINE_GUN.base.ammoCapacity);
    expect(w.enemies.hp[e]).toBeLessThan(1_000_000);
  });

  it('ignores a body outside twice its reach', () => {
    const w = droneWorld();
    ticks(w, 60);
    addEnemy(w, 400, 0, 1_000_000); // 2 x 130 = 260
    ticks(w, 120);
    expect(w.drones.state[0]).toBe(DRONE_STATE_ESCORT);
    expect(w.drones.targetDense[0]).toBe(-1);
  });

  it('comes home once the target is dead', () => {
    const w = droneWorld();
    ticks(w, 60);
    const e = addEnemy(w, 220, 0, 30);
    ticks(w, 240);
    expect(w.enemies.count).toBe(0); // it finished it
    void e;

    ticks(w, 240);
    expect(w.drones.state[0]).toBe(DRONE_STATE_ESCORT);
    expect(dist(w.drones.x[0], w.drones.y[0], w.player.x, w.player.y)).toBeLessThan(90);
  });

  it('detonates when the magazine runs dry, and the blast damages what is standing there', () => {
    const w = droneWorld();
    ticks(w, 60);
    // Fat enough to outlast the whole magazine, so the drone dies of ammo rather than of success -
    // but NOT so fat that float32 swallows the damage. hp lives in a Float32Array, where 1e9 has an
    // ulp of 64: a 5.5-damage round subtracted from it rounds straight back to 1e9 and the test
    // reads as "nothing happened".
    const e = addEnemy(w, 200, 0, 50_000);
    // A full magazine at the gun's cadence, plus slack for the flight out.
    ticks(w, Math.ceil((MACHINE_GUN.base.ammoCapacity * MACHINE_GUN.base.cooldown) / DT) + 400);

    expect(w.drones.count).toBe(0);
    // The rounds AND the blast both landed on it.
    expect(w.enemies.hp[e]).toBeLessThan(50_000);
    expect(w.stats.damageByWeapon[WEAPON_CATALOG.findIndex((d) => d.id === 'drone')]).toBeGreaterThan(
      0,
    );
  });
});
