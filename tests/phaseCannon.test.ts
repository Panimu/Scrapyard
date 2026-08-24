/**
 * THE PHASE CANNON - one bolt, through everything, into the thickest part of the crowd.
 *
 * Three things are pinned here and each is a way the weapon could be silently wrong: the densest
 * rule picks the body with the most neighbours (not the nearest, not the biggest), the bolt
 * touches NOTHING on the way to its mark and everything around it on arrival, and a mark that
 * dies mid-flight still costs the field a burst at the end of the bolt's run.
 *
 * Driven through the real pipeline stages in their real order (S5 hash -> S6 weapons -> S7
 * projectiles -> S8 collision -> S9 damage -> S12 reap), like lasers.test.ts and for the same
 * reason: the interesting failures live in the joins - a NOCONTACT flag the sweep ignores, a hit
 * pushed from S7 that S9 must apply, a handle that outlives its enemy.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  PHASE_CANNON,
  PHASE_CLUSTER_RADIUS,
  WEAPON_CATALOG,
} from '../src/core/content/weaponCatalog.js';
import { UPGRADE_CATALOG, upgradeIndex } from '../src/core/data/upgrades.js';
import { ARCH_GRUNT } from '../src/core/content/enemyCatalog.js';
import { resolveWeaponStats } from '../src/core/data/stats.js';
import { allocEnemy, markEnemyDead } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { EV_WEAPON_FIRED } from '../src/core/events/ring.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick } from '../src/core/systems/clock.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updateProjectiles } from '../src/core/systems/projectiles.js';
import { TARGETING } from '../src/core/systems/targeting.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { reapDead } from '../src/core/systems/reap.js';
import { EMPTY_INPUT, RUN_PHASE_RUNNING, type World } from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

function makeWorld(seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    {
      heroes: [testHero({ startingWeapon: 'phase-cannon' })],
      weapons: WEAPON_CATALOG,
      upgrades: UPGRADE_CATALOG,
    },
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Places one enemy and returns its DENSE index - the same helper shape lasers.test.ts uses. */
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

/** One tick of every stage a bolt touches, in pipeline order. */
function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  updateProjectiles(world, DT);
  updateCollision(world, DT);
  updateDamage(world, DT);
  reapDead(world);
}

function ticks(world: World, n: number): void {
  for (let t = 0; t < n; t++) tick(world);
}

describe('densest targeting', () => {
  it('picks the body with the most neighbours, not the nearest', () => {
    const w = makeWorld();
    // A loner close to the mech...
    addEnemy(w, 60, 0, 100);
    // ...and a three-body knot further out: the centre has two neighbours inside
    // PHASE_CLUSTER_RADIUS (45 u each side), the edges one each (90 u apart), the loner none.
    addEnemy(w, 220, 45, 100);
    const centre = addEnemy(w, 220, 0, 100);
    addEnemy(w, 220, -45, 100);
    rebuildSpatialHash(w.spatial, w.enemies);

    const rangeSq = PHASE_CANNON.base.range * PHASE_CANNON.base.range;
    const n = TARGETING.densest(w, 0, 0, rangeSq, 1, w.scratch.targets, 1, 0);
    expect(n).toBe(1);
    expect(w.scratch.targets[0]).toBe(centre);
  });

  it('breaks a count tie by distance, so the result cannot depend on visit order', () => {
    const w = makeWorld();
    // Two pairs, every body with exactly one neighbour: the nearest body of the four wins.
    const near = addEnemy(w, 100, 0, 100);
    addEnemy(w, 100, 40, 100);
    addEnemy(w, 200, 0, 100);
    addEnemy(w, 200, 40, 100);
    rebuildSpatialHash(w.spatial, w.enemies);

    const rangeSq = PHASE_CANNON.base.range * PHASE_CANNON.base.range;
    expect(TARGETING.densest(w, 0, 0, rangeSq, 1, w.scratch.targets, 1, 0)).toBe(1);
    expect(w.scratch.targets[0]).toBe(near);
  });

  it('sanity: the cluster radius the rule scores against is the one the catalog exports', () => {
    // The rule and the blast are tuned as a pair - see the catalog comment. If this moves, the
    // densest tests above are asserting against a different geometry than they were written for.
    expect(PHASE_CLUSTER_RADIUS).toBe(80);
  });
});

describe('the bolt', () => {
  it('phases through the bodies in the way, lands on its mark, and bursts on the neighbours', () => {
    const w = makeWorld();
    // Two bodies square on the flight line...
    const nearBlocker = addEnemy(w, 80, 0, 100);
    const farBlocker = addEnemy(w, 140, 0, 100);
    // ...and the knot behind them. Counts: centre 2, edges 1, blockers 1 each (60 u apart) - the
    // centre is the mark even though two bodies stand directly between it and the muzzle.
    const edgeA = addEnemy(w, 220, 45, 100);
    const centre = addEnemy(w, 220, 0, 100);
    const edgeB = addEnemy(w, 220, -45, 100);

    // The turret starts laid on (+x), so the banked shot fires immediately; the bolt crosses
    // 220 u at 460 u/s in under half a second. A second shot cannot launch inside 1.6 s.
    ticks(w, 40);

    // Nothing on the way in was touched - the whole weapon.
    expect(w.enemies.hp[nearBlocker]).toBe(100);
    expect(w.enemies.hp[farBlocker]).toBe(100);
    // The mark took the full bolt (36 at tier 1) and, as the direct hit, no splash on top.
    expect(w.enemies.hp[centre]).toBeCloseTo(100 - PHASE_CANNON.base.damage, 5);
    // The neighbours took the burst - half the bolt at the epicentre, falling off toward the
    // 55 u rim (applySplash interpolates, so the exact figure depends on where inside the mark's
    // radius the bolt happened to land; the band is the honest assertion).
    const burst = PHASE_CANNON.base.damage * PHASE_CANNON.base.splashFrac;
    expect(w.enemies.hp[edgeA]).toBeLessThan(100);
    expect(w.enemies.hp[edgeA]).toBeGreaterThanOrEqual(100 - burst);
    expect(w.enemies.hp[edgeB]).toBeLessThan(100);
    expect(w.enemies.hp[edgeB]).toBeGreaterThanOrEqual(100 - burst);
    // And the bolt is spent - one hit, no pierce, no lingering projectile.
    expect(w.projectiles.count).toBe(0);
  });

  it('counts a body finished by the burst as a SPLASH kill, and the mark itself as not', () => {
    const w = makeWorld(9);
    // The mark survives the bolt; the two neighbours die to the blast alone.
    const mark = addEnemy(w, 220, 0, 5000);
    const fragA = addEnemy(w, 220, 40, 5);
    const fragB = addEnemy(w, 220, -40, 5);
    ticks(w, 40);

    expect(w.enemies.hp[0]).toBeLessThan(5000); // the mark took the bolt (sole survivor: dense 0)
    expect(w.enemies.count).toBe(1);
    // Two splash kills, not three: the direct hit is the bolt's, whatever it did.
    expect(w.stats.splashKills).toBe(2);
    void mark;
    void fragA;
    void fragB;
  });

  it('flies on and bursts at the end of its run when the mark dies mid-flight', () => {
    const w = makeWorld();
    const mark = addEnemy(w, 200, 0, 500);
    // A bystander parked at the bolt's terminal point: muzzle 30 + 460 u/s x 1.2 s = 582.
    // Out of the weapon's own 260 u range, so it can never simply be shot instead.
    const bystander = addEnemy(w, 582, 10, 500);

    tick(w); // fires; the bolt is in the air
    expect(w.projectiles.count).toBe(1);

    // The mark dies to something else entirely.
    markEnemyDead(w.enemies, mark);
    reapDead(w);

    // The bolt keeps its last heading (+x), runs its 1.2 s fuse out, and detonateOnExpiry
    // bursts it - the stolen kill still costs whoever is standing at the arrival point.
    ticks(w, 80);
    expect(w.projectiles.count).toBe(0);
    // The bystander is the only enemy left, so it is dense index 0 after the reap - and it took
    // the burst, standing inside the 55 u ring around where the fuse ran out (less than the
    // epicentre figure by the blast's own falloff, hence the band rather than an exact number).
    expect(w.enemies.count).toBe(1);
    const burst = PHASE_CANNON.base.damage * PHASE_CANNON.base.splashFrac;
    expect(w.enemies.hp[0]).toBeLessThan(500);
    expect(w.enemies.hp[0]).toBeGreaterThanOrEqual(500 - burst);
    expect(bystander).toBeGreaterThanOrEqual(0); // fixture sanity, not behaviour
  });
});

describe('fire events name their gun', () => {
  it('stamps the firing weapon slot into EV_WEAPON_FIRED, so recoil lands on the right barrel', () => {
    // Brass's bug: one drawn turret, several guns, and the recoil used to fire for all of them -
    // a missile volley visibly kicked the Phase Cannon's barrel. The renderer now gates the kick
    // on the event's fifth payload, which is pinned here at the sim end: each event carries the
    // slot of the gun that actually fired.
    const w = makeWorld(5);
    const hero = w.heroes[w.player.heroId];
    const second = w.weapons[w.weaponCount];
    second.defId = WEAPON_CATALOG.findIndex((def) => def.id === 'missile-short');
    second.level = 1;
    resolveWeaponStats(
      WEAPON_CATALOG[second.defId],
      hero,
      1,
      w.levelUp.stacks,
      UPGRADE_CATALOG,
      second.stats,
    );
    w.weaponCount++;

    addEnemy(w, 200, 0, 500); // the phase cannon needs a target; the rack fires regardless
    tick(w);

    const slots = new Set<number>();
    const r = w.events;
    for (let i = r.readCursor; i < r.writeCursor; i++) {
      const j = i & r.mask;
      if (r.kind[j] === EV_WEAPON_FIRED) slots.add(r.e[j]);
    }
    // Both guns fired on the banked-shot tick, and each event names its own slot - neither 0 for
    // everything (the old behaviour, implicitly) nor the missile volley claiming the turret's.
    expect(slots.has(0)).toBe(true);
    expect(slots.has(1)).toBe(true);
    expect(slots.size).toBe(2);
  });
});

describe('the card and the chassis', () => {
  it('is locked behind a thousand and one killing blows with itself, across every run', () => {
    const card = UPGRADE_CATALOG[upgradeIndex('w-phase-cannon')];
    expect(card.grantsWeapon).toBe('phase-cannon');
    // `killsWithTotal`, not `killsWith`: the tally accumulates over the career rather than
    // resetting with the run. See recordCareerKills in appState.ts for the banking half.
    expect(card.unlock).toEqual({
      kind: 'killsWithTotal',
      weapons: ['phase-cannon'],
      count: 1001,
    });
  });

  it('ships the identity the design asked for: densest targeting, phasing, a slow turret', () => {
    expect(PHASE_CANNON.targeting).toBe('densest');
    expect(PHASE_CANNON.pattern).toBe('phase');
    expect(PHASE_CANNON.behaviour).toBe('phase');
    // Below the Cannon's 44, with a moderate half-strength burst.
    expect(PHASE_CANNON.base.damage).toBeLessThan(44);
    expect(PHASE_CANNON.base.splashRadius).toBeGreaterThan(0);
    expect(PHASE_CANNON.base.splashFrac).toBeLessThan(1);
    // The slowest turret in the game - slower than the Cannon's 90 deg/s.
    expect(PHASE_CANNON.base.turretTraverse).toBeLessThan((Math.PI / 180) * 90);
  });
});
