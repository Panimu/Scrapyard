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
import { resolveWeaponStats } from '../src/core/data/stats.js';
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

/** Tier 5: three drones at once, which is the fewest that can show one behaving unlike another. */
function tierFive(w: World): void {
  w.levelUp.stacks[UPGRADE_CATALOG.findIndex((d) => d.id === 'w-drone')] = 5;
  w.weapons[0].level = 5;
  resolveWeaponStats(DRONE, w.heroes[0], 5, w.levelUp.stacks, w.upgradeCatalog, w.weapons[0].stats);
}

describe('the drone bay', () => {
  it('deploys its first drone immediately and its next on the build timer', () => {
    const w = droneWorld();
    tick(w);
    expect(w.drones.count).toBe(1);
    // THE GUN'S WHOLE MAGAZINE. Loaded from the GUN and not from the bay, which carries no ammo at
    // all; reading it from there launched drones with one round that detonated on their first shot.
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

  it('measures the acquisition circle from the PLAYER, so a chain cannot walk it off the screen', () => {
    const w = droneWorld();
    ticks(w, 60);

    // THE CHAIN CASE. Park the drone out where a chain of kills would have carried it and put a
    // body right beside it: 40 u away, well inside the 260 the gun could reach from there. Under a
    // drone-anchored circle this is a target, the drone engages it, and from ITS position the next
    // one out is legal too - which is how a drone left the screen and never came back.
    w.drones.x[0] = 1100;
    w.drones.y[0] = 0;
    const e = addEnemy(w, 1140, 0, 1_000_000);
    tick(w);
    expect(w.drones.targetDense[0]).toBe(-1);
    expect(w.drones.state[0]).toBe(DRONE_STATE_ESCORT);

    // AND THE CONVERSE, which is the half that proves the rule is about the player rather than
    // just a smaller number: the drone stays exactly where it is, 900 units from home, and the
    // body moves next to the PLAYER. It is now 880 u from the drone - nearly seven times the gun's
    // reach - and it is a target, because the only distance that decides is the player's.
    w.enemies.x[e] = 20;
    tick(w);
    expect(w.drones.targetDense[0]).toBe(e);
  });

  it('drops a target that walks out of the player circle mid-engagement', () => {
    const w = droneWorld();
    ticks(w, 60);
    const e = addEnemy(w, 200, 0, 1_000_000);
    ticks(w, 120);
    expect(w.drones.targetDense[0]).toBe(e);

    // It is still right next to the drone - only its distance from the PLAYER has changed.
    w.enemies.x[e] = 1400;
    w.drones.x[0] = 1400;
    w.drones.y[0] = 0;
    tick(w);
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

  it('gives every drone its own magazine, and spending one does not touch another', () => {
    const w = droneWorld();
    tierFive(w);
    ticks(w, Math.ceil(w.weapons[0].stats.cooldown / DT) * 2 + 20);
    expect(w.drones.count).toBe(3);

    // Read from a deployed drone rather than from MACHINE_GUN.base: the gun tiers WITH the bay, so
    // a tier-5 drone carries the Machine Gun's tier-5 magazine and not its base 200.
    const full = w.drones.ammo[0];
    expect(full).toBeGreaterThan(MACHINE_GUN.base.ammoCapacity);
    for (let d = 0; d < 3; d++) expect(w.drones.ammo[d]).toBe(full);

    // THREE DELIBERATELY DIFFERENT MAGAZINES, then one body they can all reach.
    //
    // Distinct starting values are what makes this a test of independence rather than of
    // arithmetic: a shared pool would converge them, and three counters that keep their own offsets
    // while all three drones shoot the same enemy cannot be one number in disguise.
    const before = [full, full - 40, full - 90];
    for (let d = 0; d < 3; d++) w.drones.ammo[d] = before[d];

    addEnemy(w, 120, 0, 1_000_000);
    ticks(w, 200);

    const spent = [0, 1, 2].map((d) => before[d] - w.drones.ammo[d]);
    for (const n of spent) expect(n).toBeGreaterThan(0); // all three were shooting
    // Each spent only its OWN rounds: they fire on the same cadence, so the amounts match within a
    // round or two of each other rather than one draining at three times the rate.
    expect(Math.max(...spent) - Math.min(...spent)).toBeLessThanOrEqual(3);
    // And the offsets survived. A pooled magazine could not keep these apart.
    expect(new Set([w.drones.ammo[0], w.drones.ammo[1], w.drones.ammo[2]]).size).toBe(3);
  });

  it('destroys only the drone whose own magazine ran out', () => {
    const w = droneWorld();
    tierFive(w);
    ticks(w, Math.ceil(w.weapons[0].stats.cooldown / DT) * 2 + 20);
    expect(w.drones.count).toBe(3);

    // Hand ONE of them a nearly-empty magazine and give it something to shoot.
    w.drones.ammo[0] = 1;
    addEnemy(w, 60, 0, 1_000_000);
    ticks(w, 120);

    // It died; the other two are untouched and still carrying full magazines.
    expect(w.drones.count).toBe(2);
    for (let d = 0; d < w.drones.count; d++) {
      expect(w.drones.ammo[d]).toBeGreaterThan(1);
    }
  });

  it('detonates when the magazine runs dry, and the blast damages what is standing there', () => {
    const w = droneWorld();
    ticks(w, 60);
    // Fat enough to outlast the magazine, so the drone dies of ammo rather than of success - but
    // NOT so fat that float32 swallows the damage. hp lives in a Float32Array, where 1e9 has an ulp
    // of 64: a 2.75-damage round subtracted from it rounds straight back to 1e9 and the test reads
    // as "nothing happened".
    const e = addEnemy(w, 200, 0, 50_000);

    // A HANDFUL OF ROUNDS RATHER THAN THE REAL MAGAZINE, and that is the point of this edit. A full
    // 200 rounds is eighteen seconds of firing plus the flight out, against a twenty-five second
    // rebuild - so "wait for it to run dry, then check the count is 0" became a race between two
    // unrelated timings, and the test would have been asserting the gap between them. What is under
    // test is what happens AT zero, so the magazine is set to a size that gets there quickly.
    w.drones.ammo[0] = 6;
    ticks(w, 240);

    expect(w.drones.count).toBe(0);
    // The rounds AND the blast both landed on it.
    expect(w.enemies.hp[e]).toBeLessThan(50_000);
    expect(w.stats.damageByWeapon[WEAPON_CATALOG.findIndex((d) => d.id === 'drone')]).toBeGreaterThan(
      0,
    );
  });
});
