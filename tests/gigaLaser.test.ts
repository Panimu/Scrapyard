/**
 * THE GIGA LASER - the Long Laser's tier 8, and the fourth ascension.
 *
 * Four mechanics land at once and each lives in a different system, so each gets its own suite:
 * the targeting swap (updateWeapons), the swath that bills everything it covers (fireGiga), the
 * width riding `splashRadius` so AoE effects widen it (resolveWeaponStats + the tier-8 rung), and
 * the nose hardpoint claim (laserHardpoint). The gate itself - Long Laser at seven, Shaped
 * Charges held, a chest - is driven through the real card/chest route at the end.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { DT, HEAT_CAPACITY_BASE } from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { CHOOSE_REROLL } from '../src/core/constants.js';
import {
  GIGA_HALF_WIDTH,
  LASER_HARDPOINTS,
  WEAPON_CATALOG,
  weaponDefIndex,
  type WeaponId,
} from '../src/core/content/weaponCatalog.js';
import {
  UPGRADE_CATALOG,
  WEAPON_ASCENDED_TIER,
  WEAPON_MAX_TIER,
  upgradeIndex,
} from '../src/core/data/upgrades.js';
import { resolveWeaponStats } from '../src/core/data/stats.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { NO_BEAM_TARGET } from '../src/core/events/ring.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { ascensionReady, openChest, updateProgression } from '../src/core/systems/progression.js';
import { reapDead } from '../src/core/systems/reap.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type Catalogs,
  type World,
} from '../src/core/types.js';
import { createWorld } from '../src/core/world.js';

// ---------------------------------------------------------------------------------------------
// Fixtures - the lasers.test.ts shapes: a bare world where nothing moves unless a test moves it.
// ---------------------------------------------------------------------------------------------

const ARCH_GRUNT = 1;
const TOUGH_HP = 100000;

function catalogsFor(startingWeapon: WeaponId): Catalogs {
  return {
    heroes: [testHero({ startingWeapon })],
    weapons: WEAPON_CATALOG,
    // The REAL upgrade catalog, unlike the lasers fixture: the giga's width rides splashRadius
    // multipliers, and a world that cannot express Shaped Charges cannot test that.
    upgrades: UPGRADE_CATALOG,
  };
}

function makeWorld(seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    catalogsFor('laser-long'),
  );
  w.phase = RUN_PHASE_RUNNING;
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
  updateDamage(world, DT);
  reapDead(world);
  endTick(world);
}

function ticks(world: World, n: number): void {
  for (let i = 0; i < n; i++) tick(world);
}

/** Slot 0 to `tier`, re-resolved - exactly what applying the card (or the chest) does. */
function setTier(world: World, slot: number, tier: number): void {
  const inst = world.weapons[slot];
  const hero = world.heroes[world.player.heroId];
  inst.level = tier;
  resolveWeaponStats(
    world.weaponCatalog[inst.defId],
    hero,
    tier,
    world.levelUp.stacks,
    world.upgradeCatalog,
    inst.stats,
  );
}

// ---------------------------------------------------------------------------------------------

describe('the tier-8 rung', () => {
  it('doubles heat capacity and grants the swath its width; tier 7 has neither', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_MAX_TIER);
    const atSeven = w.weapons[0].stats.heatCapacity;
    // Base plus both capacity tiers - the figure the double is a double OF.
    expect(atSeven).toBe(HEAT_CAPACITY_BASE + 80);
    expect(w.weapons[0].stats.splashRadius).toBe(0);

    setTier(w, 0, WEAPON_ASCENDED_TIER);
    expect(w.weapons[0].stats.heatCapacity).toBe(atSeven * 2);
    expect(w.weapons[0].stats.splashRadius).toBe(GIGA_HALF_WIDTH);
  });

  it('widens with Shaped Charges, by exactly the ramp the catalog sells', () => {
    const w = makeWorld();
    const blast = upgradeIndex('p-blast');
    w.levelUp.stacks[blast] = WEAPON_MAX_TIER;
    setTier(w, 0, WEAPON_ASCENDED_TIER);

    // Derived from the card's own tierEffects rather than pinned, so a ramp retune moves this
    // expectation with it.
    let mul = 1;
    for (const tier of UPGRADE_CATALOG[blast].tierEffects ?? []) {
      for (const e of tier) if (e.key === 'splashRadius') mul += e.amount;
    }
    expect(mul).toBeGreaterThan(1);
    expect(w.weapons[0].stats.splashRadius).toBeCloseTo(GIGA_HALF_WIDTH * mul, 6);
  });
});

// ---------------------------------------------------------------------------------------------

describe('targeting: the densest cluster, not the weakest thing', () => {
  it('aims at the knot and ignores a weaker loner - the Long Laser rule inverted', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_ASCENDED_TIER);
    // A weak loner off the axis, and a three-body knot further out. Below tier 8 the loner is
    // the only correct target; at tier 8 the knot is.
    addEnemy(w, 100, 60, 5);
    const knot = [addEnemy(w, 200, 0, 500), addEnemy(w, 230, 0, 500), addEnemy(w, 260, 0, 500)];

    tick(w);
    expect(knot).toContain(w.weapons[0].targetDense);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the swath: full range, through everything, billing all it covers', () => {
  it('burns front body, bodies behind it, and an off-axis body inside the width - all at once', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_ASCENDED_TIER);
    const half = w.weapons[0].stats.splashRadius;
    expect(half).toBe(GIGA_HALF_WIDTH);

    // The knot the densest rule aims down: three on the axis, tight enough that the FIRST one
    // has the most neighbours outright (its 80 u disc holds both others plus the grazer) - so
    // the aim is exactly +x and every distance below is exact. The FRONT body would have
    // absorbed the whole beam at tier 7; here everything behind it burns in the same tick.
    const front = addEnemy(w, 100, 0, TOUGH_HP);
    const k1 = addEnemy(w, 200, 0, TOUGH_HP);
    const k2 = addEnemy(w, 230, 0, TOUGH_HP);
    const k3 = addEnemy(w, 260, 0, TOUGH_HP);
    // Inside the swath: centre-to-line 25 < half (12) + radius (18) = 30.
    const grazed = addEnemy(w, 150, 25, TOUGH_HP);
    // Outside it: 60 > 30, and it is NOT billed even though the old rule (weakest first) would
    // have aimed at it.
    const spared = addEnemy(w, 150, 60, 5);

    tick(w);
    expect(w.weapons[0].targetDense).toBe(k1);

    // The RESOLVED dps, not the base: tier 8 carries the ladder's two damage rungs under it.
    const burn = w.weapons[0].stats.damage * DT;
    for (const d of [front, k1, k2, k3, grazed]) {
      // 2 dp, not tighter: enemy hp is float32 and TOUGH_HP's ulp is 0.0078.
      expect(TOUGH_HP - w.enemies.hp[d], `dense ${d}`).toBeCloseTo(burn, 2);
    }
    expect(w.enemies.hp[spared]).toBe(5);
    // Damage went through the one kill path: RunStats saw all five bills.
    expect(w.stats.damageDealt).toBeCloseTo(burn * 5, 3);
  });

  it('publishes one full-range visible record and zero-length impact records for the bills', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_ASCENDED_TIER);
    const a = addEnemy(w, 200, 0, TOUGH_HP);
    const b = addEnemy(w, 240, 0, TOUGH_HP);
    tick(w);

    // Record 0: the swath itself - full range from the nose hardpoint, billing nobody.
    expect(w.beams.count).toBe(3);
    expect(w.beams.enemyDense[0]).toBe(NO_BEAM_TARGET);
    expect(w.beams.damage[0]).toBe(0);
    expect(w.beams.x0[0]).toBeCloseTo(LASER_HARDPOINTS[0].x, 5);
    const range = w.weapons[0].stats.range;
    expect(w.beams.x1[0]).toBeCloseTo(LASER_HARDPOINTS[0].x + range, 3);

    // The bills: one per covered body, zero length, at the body.
    for (let i = 1; i < w.beams.count; i++) {
      expect([a, b]).toContain(w.beams.enemyDense[i]);
      expect(w.beams.x0[i]).toBe(w.beams.x1[i]);
      expect(w.beams.damage[i]).toBeCloseTo(w.weapons[0].stats.damage * DT, 5);
    }
  });

  it('still pays heat, and the doubled capacity buys a burst twice as long', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_ASCENDED_TIER);
    addEnemy(w, 200, 0, TOUGH_HP);
    const stats = w.weapons[0].stats;

    const burstTicks = Math.round(stats.heatCapacity / stats.heatPerSec / DT);
    ticks(w, burstTicks - 1);
    expect(w.weapons[0].overheated).toBe(false);
    ticks(w, 1);
    expect(w.weapons[0].overheated).toBe(true);
    // Twice the tier-7 burst: same generation, doubled ceiling.
    expect(stats.heatCapacity).toBe((HEAT_CAPACITY_BASE + 80) * 2);
  });
});

// ---------------------------------------------------------------------------------------------

describe('the nose hardpoint is the giga\'s by right', () => {
  it('fires from the nose and pushes another laser to the shoulder', () => {
    const w = makeWorld();
    setTier(w, 0, WEAPON_ASCENDED_TIER);

    // A second beam, fitted by hand at tier 1 (the gate cares what is held, not how it arrived).
    const inst = w.weapons[w.weaponCount];
    inst.defId = weaponDefIndex('laser-medium');
    inst.level = 1;
    w.weaponCount++;
    setTier(w, 1, 1);

    // Two bodies so the claim rule leaves the medium something to burn.
    addEnemy(w, 200, 0, TOUGH_HP);
    addEnemy(w, 120, -30, TOUGH_HP);
    tick(w);

    // Facing is +x at spawn, so hardpoints land un-rotated. TWO beams held used to mean both on
    // the shoulders; the giga overrides that and takes the nose, medium gets a shoulder.
    let sawGiga = false;
    let sawMedium = false;
    for (let i = 0; i < w.beams.count; i++) {
      if (w.beams.weaponIdx[i] === 0 && !sawGiga) {
        sawGiga = true;
        expect(w.beams.x0[i]).toBeCloseTo(LASER_HARDPOINTS[0].x, 5);
        expect(w.beams.y0[i]).toBeCloseTo(LASER_HARDPOINTS[0].y, 5);
      }
      if (w.beams.weaponIdx[i] === 1) {
        sawMedium = true;
        expect(w.beams.x0[i]).toBeCloseTo(LASER_HARDPOINTS[1].x, 5);
        expect(w.beams.y0[i]).toBeCloseTo(LASER_HARDPOINTS[1].y, 5);
      }
    }
    expect(sawGiga).toBe(true);
    expect(sawMedium).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------
// The gate, through the real route: cards for the tiers, Shaped Charges held, a Cyber Chest.
// ---------------------------------------------------------------------------------------------

describe('the ascension gate', () => {
  function gateWorld(): World {
    const w = createWorld({
      seed: 5, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING, levelId: 'scrapyard',
    });
    w.phase = RUN_PHASE_RUNNING;
    w.player.stats.xpGain = 1;
    return w;
  }

  function idxOf(w: World, id: string): number {
    return w.upgradeCatalog.findIndex((d) => d?.id === id);
  }

  function takeCard(w: World, idx: number, tries = 400): boolean {
    w.infiniteRerolls = true;
    for (let i = 0; i < tries; i++) {
      if (w.phase !== RUN_PHASE_LEVEL_UP) {
        w.xpBanked = (w.player.xpToNext - w.player.xp) / (w.player.stats.xpGain || 1);
        updateProgression(w, DT);
      }
      if (w.phase !== RUN_PHASE_LEVEL_UP) return false;
      let slot = -1;
      for (let k = 0; k < w.levelUp.offerCount; k++) if (w.levelUp.offers[k] === idx) slot = k;
      w.input.chooseIndex = slot >= 0 ? slot : CHOOSE_REROLL;
      updateProgression(w, DT);
      w.input.chooseIndex = -1;
      if (slot >= 0) return true;
    }
    return false;
  }

  it('needs the beam at seven AND Shaped Charges held - and a chest then pays out tier 8', () => {
    const w = gateWorld();
    const laser = idxOf(w, 'w-laser-long');
    const blast = idxOf(w, 'p-blast');

    for (let i = 0; i < WEAPON_MAX_TIER; i++) expect(takeCard(w, laser)).toBe(true);
    expect(w.levelUp.stacks[laser]).toBe(WEAPON_MAX_TIER);
    // Seven tiers of beam alone do not open it: the passive is the other half of the gate.
    expect(ascensionReady(w, laser)).toBe(false);

    // Shaped Charges is OFFERED to this loadout at all only because the Long Laser is on its
    // requiresWeaponHeld list - a pure laser build must be able to buy its own ascension key.
    expect(takeCard(w, blast)).toBe(true);
    expect(ascensionReady(w, laser)).toBe(true);

    openChest(w);
    expect(w.phase).toBe(RUN_PHASE_CHEST);
    expect(w.chest.ascension).toBe(laser);
    w.input.chooseIndex = 0;
    updateProgression(w, DT);
    w.input.chooseIndex = -1;

    expect(w.levelUp.stacks[laser]).toBe(WEAPON_ASCENDED_TIER);
    let inst = null;
    for (let i = 0; i < w.weaponCount; i++) {
      if (w.weaponCatalog[w.weapons[i].defId].id === 'laser-long') inst = w.weapons[i];
    }
    expect(inst).not.toBeNull();
    expect(inst?.level).toBe(WEAPON_ASCENDED_TIER);
    expect(inst?.stats.splashRadius).toBeGreaterThanOrEqual(GIGA_HALF_WIDTH);
    expect(inst?.stats.heatCapacity).toBeGreaterThanOrEqual((HEAT_CAPACITY_BASE + 80) * 2);
  });
});
