/**
 * THE LASERS - one mechanic, three tempos (DESIGN.md, content/weaponCatalog.ts "The lasers").
 *
 * Every test here drives the REAL pipeline stages in their real order:
 *
 *     S5 rebuildSpatialHash -> S6 updateWeapons -> S9 updateDamage -> S12 reapDead
 *
 * rather than calling the raycast or the heat arithmetic directly. That is deliberate: a beam is
 * only correct if it survives the spatial hash, the DEAD flag, the dense/slot split and the
 * detection/application seam - and the interesting failures (a corpse blocking the line, damage
 * applied twice because the buffer was not cleared, a beam that fires on the tick it cut out)
 * all live in the joins rather than in any one function.
 *
 * Spawning, enemy AI and collision are deliberately absent, so nothing moves unless a test moves
 * it and a failure here is unambiguously a laser failure.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import {
  CHOOSE_REROLL,
  DT,
  HEAT_CAPACITY_BASE,
  HEAT_RESUME_FRAC,
  MAX_WEAPONS,
  TICK_RATE,
} from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CANNON,
  BEAM_MOUNTS,
  LASER_HARDPOINTS,
  laserHardpoint,
  LASER_LONG,
  LASER_MEDIUM,
  LASER_SHORT,
  WEAPON_CATALOG,
  weaponDefIndex,
  type WeaponDef,
  type WeaponId,
} from '../src/core/content/weaponCatalog.js';
import {
  UPGRADE_CATALOG,
  WEAPON_MAX_TIER,
  upgradeIndex,
  upgradeIndexForWeapon,
} from '../src/core/data/upgrades.js';
import { resolveWeaponStats, type WeaponStats } from '../src/core/data/stats.js';
import type { HeroDef } from '../src/core/data/heroes.js';
import { allocEnemy } from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { NO_BEAM_TARGET } from '../src/core/events/ring.js';
import { hashWorld } from '../src/core/hash.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updateProgression } from '../src/core/systems/progression.js';
import { betterLowestHp, TARGETING } from '../src/core/systems/targeting.js';
import { reapDead } from '../src/core/systems/reap.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type Catalogs,
  type InputFrame,
  type World,
} from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

/**
 * A hero with EMPTY multiplier maps, so every laser resolves to exactly its catalog numbers and
 * the expectations below are read from the catalog rather than pinned, so a balance pass moves
 * them automatically.
 */
function heroWith(startingWeapon: WeaponId): HeroDef {
  return testHero({ startingWeapon });
}

/** No enemy catalog and no upgrades: nothing spawns, nothing levels, only the weapon runs. */
function catalogsFor(startingWeapon: WeaponId): Catalogs {
  return {
    heroes: [heroWith(startingWeapon)],
    weapons: WEAPON_CATALOG,
    upgrades: [],
  };
}

const ARCH_GRUNT = 1;

function makeWorld(startingWeapon: WeaponId, seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    catalogsFor(startingWeapon),
  );
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Places one enemy and returns its DENSE index. spawnIds come from the director, as in a run. */
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

/** One tick of the stages a beam touches, in pipeline order. */
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

/** Refreshes the hash without advancing time, for the direct-comparator tests. */
function sync(world: World): void {
  rebuildSpatialHash(world.spatial, world.enemies);
}

/**
 * Puts the weapon in slot 0 at `tier` and re-resolves its stats, exactly as applying that card
 * would (progression.ts writes `level` and then re-resolves every live weapon).
 *
 * Used by the heat suite because THOSE tests are about what the weapon system does with three
 * numbers, not about how the numbers were earned - the card path that earns them is covered
 * end-to-end in progression.test.ts. Going through the card here would need a dozen level-ups per
 * assertion and would put the RNG between the tier and the burst length it is supposed to explain.
 */
function setTier(world: World, tier: number): void {
  const inst = world.weapons[0];
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

const LASERS: readonly { def: WeaponDef; id: WeaponId; dps: number; heat: number }[] = [
  // Read from the catalog, never pinned. These suites are about the MECHANIC - damage is per
  // second, heat gates firing, a blocked line refuses the shot - and a balance pass that moves a
  // laser's dps must not turn any of that red.
  { def: LASER_SHORT, id: 'laser-short', dps: LASER_SHORT.base.damage, heat: LASER_SHORT.base.heatPerSec },
  { def: LASER_MEDIUM, id: 'laser-medium', dps: LASER_MEDIUM.base.damage, heat: LASER_MEDIUM.base.heatPerSec },
  { def: LASER_LONG, id: 'laser-long', dps: LASER_LONG.base.damage, heat: LASER_LONG.base.heatPerSec },
];

// ---------------------------------------------------------------------------------------------

describe('the catalog numbers reach the resolved weapon', () => {
  it('gives each laser its own dps, range and heat rate, and marks it a beam', () => {
    for (const laser of LASERS) {
      const w = makeWorld(laser.id);
      const inst = w.weapons[0];
      expect(w.weaponCount).toBe(1);
      expect(w.weaponCatalog[inst.defId].kind).toBe('beam');
      expect(w.weaponCatalog[inst.defId].targeting).toBe('lowest-hp');
      expect(w.weaponCatalog[inst.defId].pattern).toBe('beam');
      expect(inst.stats.damage).toBe(laser.dps);
      expect(inst.stats.heatPerSec).toBe(laser.heat);
      expect(inst.heat).toBe(0);
      expect(inst.overheated).toBe(false);
    }
    // The three reaches are pinned as ORDERED and SEPARATED rather than as three literals: the
    // absolute numbers are a balance dial that has already moved once, and a test that has to be
    // edited every time one does is a test that gets edited without being read.
    expect(LASER_SHORT.base.range).toBeLessThan(LASER_MEDIUM.base.range);
    expect(LASER_MEDIUM.base.range).toBeLessThan(LASER_LONG.base.range);
    // Each is at least half again the one below it, which is what makes them three weapons rather
    // than one weapon at three prices.
    expect(LASER_MEDIUM.base.range).toBeGreaterThan(LASER_SHORT.base.range * 1.5);
    expect(LASER_LONG.base.range).toBeGreaterThan(LASER_MEDIUM.base.range * 1.5);
    // And the shortest still outreaches the Machine Gun, the one weapon meant to be closer in.
    expect(LASER_SHORT.base.range).toBeGreaterThan(130);
  });
});

// ---------------------------------------------------------------------------------------------

describe('targeting: the WEAKEST enemy in range', () => {
  it('picks the 5 HP enemy over the 40 and the 900, whatever the distance', () => {
    const w = makeWorld('laser-medium');
    addEnemy(w, 40, 0, 900); // nearest, and by far the biggest
    const weak = addEnemy(w, 240, 0, 5); // furthest, and the weakest
    addEnemy(w, 120, 0, 40);
    sync(w);

    const n = TARGETING['lowest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets, 1, 0);
    expect(n).toBe(1);
    expect(w.scratch.targets[0]).toBe(weak);
  });

  it('never reaches past its own range', () => {
    const w = makeWorld('laser-short');
    // Placed RELATIVE to the weapon's own resolved range rather than at literal distances: the
    // three laser reaches are a balance dial and this test is about the range CHECK, not about
    // any particular number. Hardcoding 140 and 160 made it fail the moment the base moved 10%.
    const range = w.weapons[0].stats.range;
    const inRange = addEnemy(w, range - 10, 0, 90);
    addEnemy(w, range + 10, 0, 1); // weaker, and just too far
    sync(w);

    const n = TARGETING['lowest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets, 1, 0);
    expect(n).toBe(1);
    expect(w.scratch.targets[0]).toBe(inRange);
  });

  it('breaks an hp tie by distance, then by spawnId - a STRICT TOTAL order', () => {
    const w = makeWorld('laser-medium');
    const far = addEnemy(w, 200, 0, 30);
    const near = addEnemy(w, 100, 0, 30);
    sync(w);
    const e = w.enemies;

    // Equal hp: the nearer one wins, in both directions of the comparison.
    expect(betterLowestHp(e, near, far, 0, 0)).toBe(true);
    expect(betterLowestHp(e, far, near, 0, 0)).toBe(false);

    // Equal hp AND equal distance: the older spawnId wins, which can never tie.
    const mirror = addEnemy(w, -100, 0, 30);
    expect(e.spawnId[near]).toBeLessThan(e.spawnId[mirror]);
    expect(betterLowestHp(e, near, mirror, 0, 0)).toBe(true);
    expect(betterLowestHp(e, mirror, near, 0, 0)).toBe(false);

    // And lower hp still beats both, so key 1 outranks keys 2 and 3.
    const weakAndFar = addEnemy(w, 260, 0, 29);
    expect(betterLowestHp(e, weakAndFar, near, 0, 0)).toBe(true);
  });

  it('retargets the moment the weakest dies, and burns the next one down', () => {
    const w = makeWorld('laser-medium');
    const weak = addEnemy(w, 100, 0, 5);
    const tough = addEnemy(w, 160, 0, 500);

    // 5 HP at the Medium Laser's dps: dead within a handful of ticks.
    ticks(w, 1);
    expect(w.weapons[0].targetDense).toBe(weak);

    ticks(w, 10);
    // The weak one is gone (reaped at S12), and the beam has moved to the survivor.
    expect(w.enemies.count).toBe(1);
    expect(w.stats.kills).toBe(1);
    const survivor = 0; // the swap-remove left the tough one as the only dense entry
    expect(w.enemies.hp[survivor]).toBeLessThan(500);
    expect(w.weapons[0].targetDense).toBe(survivor);
    void tough;
  });
});

// ---------------------------------------------------------------------------------------------

describe('the line: a beam burns whatever is in the way', () => {
  it('AIMS at the weakest and DAMAGES the body in front of it', () => {
    // Aim and impact are two different things. The weakest enemy decides where the beam points;
    // whatever the ray touches first takes the burn.
    const w = makeWorld('laser-medium'); // range 275
    const blocker = addEnemy(w, 100, 0, 500);
    const target = addEnemy(w, 200, 0, 5);

    ticks(w, 60);

    // Still aiming at the weakest...
    expect(w.weapons[0].targetDense).toBe(target);
    // ...and the body in the way is the one being melted. The target has not been touched.
    expect(w.beams.count).toBe(1);
    expect(w.beams.enemyDense[0]).toBe(blocker);
    expect(w.enemies.hp[target]).toBe(5);
    expect(w.enemies.hp[blocker]).toBeLessThan(500);
    expect(w.stats.damageDealt).toBeGreaterThan(0);
    // And it PAID for the shot: a blocked line used to be free, which is what made a laser go
    // quiet exactly when the horde closed up.
    expect(w.weapons[0].heat).toBeGreaterThan(0);

    // Step the blocker aside. Same enemies, same target - now the target itself takes it.
    const blockerHp = w.enemies.hp[blocker];
    w.enemies.y[blocker] = 100;
    ticks(w, 1);

    expect(w.beams.enemyDense[0]).toBe(target);
    expect(w.enemies.hp[target]).toBeCloseTo(5 - LASER_MEDIUM.base.damage * DT, 6);
    expect(w.enemies.hp[blocker]).toBe(blockerHp); // out of the line, out of the fight
  });

  it('stops on a body that only CLIPS the line, not just one centred on it', () => {
    const w = makeWorld('laser-medium');
    // 17 u off the axis with an 18 u radius: the circle overlaps the line by one unit.
    const clipper = addEnemy(w, 100, 17, 500, 18);
    const target = addEnemy(w, 200, 0, 5);

    ticks(w, 30);
    expect(w.beams.enemyDense[0]).toBe(clipper);
    expect(w.enemies.hp[clipper]).toBeLessThan(500);
    expect(w.enemies.hp[target]).toBe(5);

    // 19 u off the axis with the same radius: it clears the line by a unit and the beam goes
    // through to the target it was aiming at all along.
    const clipperHp = w.enemies.hp[clipper];
    w.enemies.y[clipper] = 19;
    ticks(w, 1);
    expect(w.beams.enemyDense[0]).toBe(target);
    expect(w.enemies.hp[clipper]).toBe(clipperHp);
  });

  it('is not blocked by a CORPSE - a body killed this tick shields nothing', () => {
    const w = makeWorld('laser-medium');
    const blocker = addEnemy(w, 100, 0, 1); // weakest: it is the target first
    const behind = addEnemy(w, 200, 0, 500);

    // One tick kills the 1 HP blocker (55 * dt = 0.917 > ... not quite), so give it a few.
    ticks(w, 3);
    expect(w.enemies.count).toBe(1);
    expect(w.stats.kills).toBe(1);
    void blocker;
    void behind;

    // With the corpse reaped the line is clear, and the beam is already on the survivor.
    ticks(w, 1);
    expect(w.beams.count).toBe(1);
    expect(w.enemies.hp[0]).toBeLessThan(500);
  });

  it('stops the drawn line ON the target, and starts it at the hardpoint', () => {
    const w = makeWorld('laser-short');
    const target = addEnemy(w, 100, 0, 500, 18);
    ticks(w, 1);

    expect(w.beams.count).toBe(1);
    expect(w.beams.enemyDense[0]).not.toBe(NO_BEAM_TARGET);
    // ONE laser held -> the NOSE hardpoint, 21 u ahead of centre along the facing (+x at spawn).
    // The hardpoint is the TRUE origin - the ray starts there too, not only the drawn line - so
    // the endpoint is the target's near face measured from it: 21 + ((100 - 21) - 18) = 82.
    expect(w.beams.x0[0]).toBeCloseTo(LASER_HARDPOINTS[0].x, 9);
    expect(w.beams.y0[0]).toBeCloseTo(0, 9);
    expect(w.beams.x1[0]).toBeCloseTo(82, 6);
    expect(w.beams.y1[0]).toBeCloseTo(0, 9);
    void target;
  });

  it('finds a target the ray only reaches diagonally, across several hash cells', () => {
    // 3-4-5 at 20x: the target sits 100 u right and 75 u up, 125 u away, five cells from the
    // muzzle. A hash walk that only visited the muzzle's own cell would find nothing here.
    const w = makeWorld('laser-short');
    const target = addEnemy(w, 100, 75, 500, 18);

    // Traverse from +x to the target takes a few ticks at 720 deg/s.
    ticks(w, 20);
    expect(w.beams.count).toBe(1);
    expect(w.beams.enemyDense[0]).toBe(target);
    expect(w.enemies.hp[target]).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * Enemy hp is a Float32Array, so a target big enough to survive a long burn cannot also resolve
 * a hundredth of a point of damage. TOUGH_HP is chosen to keep both true for every test here:
 * 1e5 has a float32 ulp of 0.0078, which resolves the short laser's 0.5-per-tick EXACTLY and
 * every other rate to well under a point across thousands of ticks.
 */
const TOUGH_HP = 100000;

describe('damage is PER SECOND', () => {
  it('deals exactly the listed damage over 1.0 s of contact, for all three', () => {
    for (const laser of LASERS) {
      const w = makeWorld(laser.id);
      // 1000 rather than TOUGH_HP: hp is float32, and the second assertion below is a
      // DIFFERENCE of two large numbers. At 1e5 the ulp is 0.0078 and sixty subtractions of
      // 0.9166 drift by an eighth of a point; at 1e3 they drift by a thousandth.
      const target = addEnemy(w, 100, 0, 1000);

      ticks(w, TICK_RATE); // exactly one second

      // RunStats accumulates the per-tick figure the sim actually applied, so this is the exact
      // statement of "damage is per second": sixty ticks of dps/60. The residue is the beam
      // buffer's Float32Array storing dps/60 - about a millionth of a point over a second.
      expect(w.stats.damageDealt).toBeCloseTo(laser.dps, 4);
      // And the hp that actually came off the target is the same number.
      expect(1000 - w.enemies.hp[target]).toBeCloseTo(laser.dps, 2);
    }
  });

  it('applies the buffered figure verbatim - updateDamage never rescales by dt', () => {
    const w = makeWorld('laser-long');
    const target = addEnemy(w, 100, 0, TOUGH_HP);
    ticks(w, 1);

    expect(w.beams.count).toBe(1);
    // The buffer is Float32Array, so this is 85/60 to float32 precision - and it is what
    // updateDamage applied, unchanged.
    expect(w.beams.damage[0]).toBeCloseTo(LASER_LONG.base.damage * DT, 5);
    expect(w.stats.damageDealt).toBe(w.beams.damage[0]);
    expect(TOUGH_HP - w.enemies.hp[target]).toBeCloseTo(w.beams.damage[0], 2);
  });

  it('applies each beam exactly once per tick - the buffer is cleared, not accumulated', () => {
    const w = makeWorld('laser-short');
    addEnemy(w, 100, 0, TOUGH_HP);

    for (let i = 1; i <= 10; i++) {
      tick(w);
      // One beam this tick, never ten, and the damage tracks the tick count linearly.
      expect(w.beams.count).toBe(1);
      // The beam buffer is Float32Array, so compare at float32 precision, not float64.
      expect(w.stats.damageDealt).toBeCloseTo(LASER_SHORT.base.damage * DT * i, 4);
    }
  });

  it('kills through the same path as a shell: kill feed, tally and phase all move', () => {
    const w = makeWorld('laser-long');
    addEnemy(w, 100, 0, 2); // the Long Laser kills a 2 HP grunt in a couple of ticks

    ticks(w, 1);
    expect(w.stats.kills).toBe(0);
    ticks(w, 1);

    expect(w.stats.kills).toBe(1);
    expect(w.stats.killsByArchetype[ARCH_GRUNT]).toBe(1);
    // Effective damage, not raw: the overkill on the last tick is not billed.
    expect(w.stats.damageDealt).toBeCloseTo(2, 6);
    expect(w.enemies.count).toBe(0); // reaped at S12
  });

  it('never applies knockback', () => {
    const w = makeWorld('laser-long');
    const target = addEnemy(w, 100, 0, TOUGH_HP);
    ticks(w, 30);

    expect(w.enemies.pushX[target]).toBe(0);
    expect(w.enemies.pushY[target]).toBe(0);
    expect(w.enemies.x[target]).toBe(100);
  });
});

// ---------------------------------------------------------------------------------------------

describe('heat: the limiter, and the hysteresis that makes it one', () => {
  /**
   * Fires a laser at a target that cannot die and records, per tick, whether a beam left the
   * emitter - plus the ticks on which it cut out and came back. Everything below is derived from
   * those three series, so no expectation depends on a number this file made up.
   */
  interface Burn {
    /** fired[t] === true when tick t produced a beam. */
    readonly fired: boolean[];
    /** Ticks on which `overheated` latched, in order. */
    readonly overheats: number[];
    /** Ticks on which it unlatched, in order. */
    readonly resumes: number[];
  }

  function burnWorld(w: World, totalTicks: number): Burn {
    const fired: boolean[] = [];
    const overheats: number[] = [];
    const resumes: number[] = [];

    for (let t = 0; t < totalTicks; t++) {
      const before = w.weapons[0].overheated;
      tick(w);
      fired.push(w.beams.count > 0);
      const after = w.weapons[0].overheated;
      if (!before && after) overheats.push(t);
      if (before && !after) resumes.push(t);
    }
    return { fired, overheats, resumes };
  }

  function burn(id: WeaponId, totalTicks: number, tier = 1): Burn {
    const w = makeWorld(id);
    addEnemy(w, 100, 0, TOUGH_HP);
    if (tier !== 1) setTier(w, tier);
    return burnWorld(w, totalTicks);
  }

  /** Fraction of ticks in [from, to) that fired. */
  function duty(b: Burn, from: number, to: number): number {
    let n = 0;
    for (let t = from; t < to; t++) if (b.fired[t]) n++;
    return n / (to - from);
  }

  it('takes the short laser to its own capacity in exactly 13.3 s and latches there', () => {
    const w = makeWorld('laser-short');
    addEnemy(w, 100, 0, TOUGH_HP);

    // THE CEILING IS THE WEAPON'S, not a global constant. At tier 1 it is the shipping base and
    // the resume line is the documented fraction of it.
    const stats = w.weapons[0].stats;
    const cap = stats.heatCapacity;
    const resume = stats.heatResume;
    const gen = stats.heatPerSec;
    expect(cap).toBe(HEAT_CAPACITY_BASE);
    expect(resume).toBe(cap * HEAT_RESUME_FRAC);
    // THE BURST IS DERIVED, not hardcoded: 100 capacity at 7.5 heat/s is 800 ticks. It was 600
    // when generation was 10/s, and pinning the tick count to a balance number meant a heat
    // retune failed a test about the LATCH. The mechanic is "the tick that reaches capacity still
    // fires, and the weapon is off from the next one" - that is what is asserted below, at
    // whatever rate the weapon is authored to.
    const burstTicks = Math.round(cap / gen / DT);
    expect(burstTicks).toBe(800);

    // One tick short of the ceiling: still live, still firing, heat just under capacity.
    ticks(w, burstTicks - 1);
    expect(w.weapons[0].overheated).toBe(false);
    expect(w.weapons[0].heat).toBeLessThan(cap);
    expect(w.weapons[0].heat).toBeCloseTo(cap - gen * DT, 6);
    expect(w.beams.count).toBe(1);

    // The LAST tick of the burst delivers its damage AND cuts the weapon out, which is why a full
    // burst is exactly heatCapacity/heatPerSec seconds of damage rather than one tick less.
    ticks(w, 1);
    expect(burstTicks * DT).toBeCloseTo(cap / gen, 9);
    expect(w.weapons[0].heat).toBe(cap); // clamped, never above
    expect(w.weapons[0].overheated).toBe(true);
    expect(w.beams.count).toBe(1);

    const hpAtCutout = w.enemies.hp[0];
    // One full COLD burst is capacity/generation seconds of fire, so the damage it delivers is
    // exactly that times the beam's dps. Derived, so a retune of either number stays true.
    const coldBurstDamage = stats.damage * (cap / stats.heatPerSec);
    // WITHIN 0.5%, NOT TO A DECIMAL PLACE. Enemy hp is a Float32Array and the beam subtracts from
    // it once per tick, so six hundred roundings accumulate a fraction of a point. Demanding exact
    // equality here would be asserting the storage format, not the mechanic.
    expect(TOUGH_HP - hpAtCutout).toBeGreaterThan(coldBurstDamage * 0.995);
    expect(TOUGH_HP - hpAtCutout).toBeLessThanOrEqual(coldBurstDamage * 1.005);
    expect(w.stats.damageDealt).toBeGreaterThan(coldBurstDamage * 0.995);
    expect(w.stats.damageDealt).toBeLessThanOrEqual(coldBurstDamage * 1.005);

    // And now it is OFF. Not throttled, not dimmed - off, and it stays off while heat is above
    // its resume line even though heat is below its capacity the whole way down.
    const slideTicks = Math.round(((cap - resume) / stats.heatDispersion) * 60);
    for (let t = 1; t < slideTicks; t++) {
      tick(w);
      expect(w.beams.count).toBe(0);
      expect(w.weapons[0].overheated).toBe(true);
      expect(w.weapons[0].heat).toBeLessThan(cap);
      expect(w.weapons[0].heat).toBeGreaterThan(resume);
    }
    expect(w.enemies.hp[0]).toBe(hpAtCutout); // not one point of damage while cut out

    // The last tick of the slide is the one that reaches the resume line. The slide is
    // (capacity - resume) / DISPERSION seconds - dispersion, not generation, which is what makes
    // the off half of the cycle longer than the on half.
    tick(w);
    // Tolerance is ONE TICK, not a decimal place: the slide is a whole number of discrete ticks
    // and the exact quotient almost never lands on a tick boundary.
    expect(Math.abs(slideTicks * DT - (cap - resume) / stats.heatDispersion)).toBeLessThanOrEqual(
      DT,
    );
    expect(w.weapons[0].overheated).toBe(false);
    // At or just below the resume line - the tick that crosses it can overshoot by up to one
    // tick's worth of dispersion, which is the same discreteness the slide length has.
    expect(w.weapons[0].heat).toBeLessThanOrEqual(resume);
    expect(w.weapons[0].heat).toBeGreaterThan(resume - stats.heatDispersion * DT * 2);
    expect(w.beams.count).toBe(0); // the unlatching tick does not fire

    // The tick after that, it is a laser again.
    tick(w);
    expect(w.beams.count).toBe(1);
    expect(w.enemies.hp[0]).toBeLessThan(hpAtCutout);
  });

  it('runs the same cycle for all three, scaled by heat rate alone', () => {
    for (const laser of LASERS) {
      const w = makeWorld(laser.id);
      addEnemy(w, 100, 0, TOUGH_HP);
      const s = w.weapons[0].stats;
      const burstSec = s.heatCapacity / s.heatPerSec;
      const coolSec = (s.heatCapacity - s.heatResume) / s.heatDispersion;
      const b = burnWorld(w, Math.ceil((burstSec + coolSec) * TICK_RATE) + 5);

      expect(b.overheats.length).toBeGreaterThanOrEqual(1);
      expect(b.resumes.length).toBeGreaterThanOrEqual(1);
      // Float accumulation of heatPerSec * dt can land a single tick either side of the exact
      // second, so the tolerance is one tick rather than a percentage.
      expect(Math.abs((b.overheats[0] + 1) * DT - burstSec)).toBeLessThanOrEqual(DT);
      expect(Math.abs((b.resumes[0] - b.overheats[0]) * DT - coolSec)).toBeLessThanOrEqual(DT);
    }
    // The short laser holds a burst three times as long as the long one - same rhythm, very
    // different tempo. Both start from the same capacity, so this is the heat rates alone.
    // Same capacity, rising generation: burst length shortens as the beam gets heavier. That
    // ordering is the design; the exact ratio is a balance dial.
    expect(LASER_LONG.base.heatPerSec).toBeGreaterThan(LASER_MEDIUM.base.heatPerSec);
    expect(LASER_MEDIUM.base.heatPerSec).toBeGreaterThan(LASER_SHORT.base.heatPerSec);
    expect(LASER_LONG.base.heatCapacity).toBe(LASER_SHORT.base.heatCapacity);
  });

  it('gives each laser its own duty cycle, ordered short > medium > long, all under half', () => {
    // THE RANKING IS THE DESIGN. Dispersion is authored per laser and sits well below generation
    // on all three, so every laser spends most of a fight cooling - and the SHORT one, which has
    // to stand closest to work at all, is rewarded with the most uptime and the best sustained
    // output of the three. The long laser pays for its reach with silence.
    //
    // Measured from one resume to the next so a partial cycle cannot flatter the figure, and
    // compared against dispersion / (generation + dispersion), which is what uptime IS.
    const measured: { id: string; duty: number; predicted: number; sustained: number }[] = [];

    for (const laser of LASERS) {
      const cycleTicks = Math.ceil((HEAT_CAPACITY_BASE / laser.heat) * TICK_RATE) * 3;
      const b = burn(laser.id, cycleTicks * 10);
      expect(b.resumes.length).toBeGreaterThanOrEqual(3);

      const gen = laser.def.base.heatPerSec;
      const disp = laser.def.base.heatDispersion;
      const predicted = disp / (gen + disp);
      const d = duty(b, b.resumes[0] + 1, b.resumes[2] + 1);
      measured.push({ id: laser.id, duty: d, predicted, sustained: laser.dps * d });
    }

    for (const m of measured) {
      // The simulated cycle matches the closed form, which is the real assertion: uptime is a
      // property of two authored numbers and nothing else.
      expect(m.duty).toBeCloseTo(m.predicted, 2);
      // A BEAM STILL SPENDS A REAL PART OF EVERY FIGHT OFFLINE. The bound is 0.6 rather than the
      // 0.5 it was: cutting generation 25% to lift the beams as a class put the SHORT laser at
      // 53% uptime - its dispersion (8.5/s) now exceeds its generation (7.5/s), which is only
      // possible at all because dispersion applies while IDLE and never while firing, so the
      // weapon still overheats after a full burst. The other two remain under half.
      expect(m.duty).toBeLessThan(0.6);
    }

    const [short, medium, long] = measured;
    expect(short.duty).toBeGreaterThan(medium.duty);
    expect(medium.duty).toBeGreaterThan(long.duty);
    // And the point of the retune: the CLOSE-range laser delivers the most over a long fight.
    expect(short.sustained).toBeGreaterThan(medium.sustained);
    expect(medium.sustained).toBeGreaterThan(long.sustained);
  });

  it('cools while it has no target, so a fight is not entered at 99 heat', () => {
    const w = makeWorld('laser-short');
    const target = addEnemy(w, 100, 0, TOUGH_HP);
    // Derived from the weapon rather than hardcoded, so a heat retune moves the fixture with it.
    const genShort = w.weapons[0].stats.heatPerSec;
    ticks(w, 300);
    expect(w.weapons[0].heat).toBeCloseTo(genShort * 300 * DT, 6);

    // The target walks out of range and the emitter starts shedding heat at its OWN dispersion
    // rate, which is well below its generation rate - that asymmetry is what puts every laser
    // under half uptime.
    const heatBefore = w.weapons[0].heat;
    const disp = LASER_SHORT.base.heatDispersion;
    w.enemies.x[target] = 100000;
    ticks(w, 150);
    expect(w.weapons[0].heat).toBeCloseTo(heatBefore - disp * 150 * DT, 5);
    expect(w.weapons[0].targetDense).toBe(-1);
    // Long enough to shed a full capacity at this laser's dispersion, whatever that is.
    ticks(w, Math.ceil((LASER_SHORT.base.heatCapacity / disp) * 60) + 10);
    expect(w.weapons[0].heat).toBe(0); // clamped at the floor, never negative
  });

  it('keeps heating when a body steps into the line - a blocked shot is still a shot', () => {
    const w = makeWorld('laser-medium');
    const target = addEnemy(w, 200, 0, TOUGH_HP);
    ticks(w, 60);
    expect(w.weapons[0].heat).toBeCloseTo(LASER_MEDIUM.base.heatPerSec, 5);

    // A body steps into the line. Nothing about the weapon's tempo changes: it keeps firing at
    // the same rate and keeps heating at the same rate - only the recipient of the damage moves.
    const blocker = addEnemy(w, 100, 0, TOUGH_HP);
    const heatBefore = w.weapons[0].heat;
    const targetHp = w.enemies.hp[target]; // it has been burning for a second already
    ticks(w, 30);
    expect(w.beams.enemyDense[0]).toBe(blocker);
    expect(w.weapons[0].heat).toBeCloseTo(
      heatBefore + LASER_MEDIUM.base.heatPerSec * 30 * DT,
      5,
    );
    expect(w.enemies.hp[blocker]).toBeLessThan(TOUGH_HP);
    expect(w.enemies.hp[target]).toBe(targetHp); // not one more point once it is screened
  });

  // -------------------------------------------------------------------------------------------
  // THE THREE HEAT STATS ARE THE WEAPON'S OWN, AND THEY ARE THREE DIFFERENT NUMBERS
  //
  // heatPerSec (up), heatCapacity (the ceiling) and heatDispersion (down) start in a fixed
  // relationship on an untiered laser and are pulled apart by the ladder. Every test below reads
  // the weapon's resolved stats and asserts the BEHAVIOUR follows them - which is the only way to
  // catch the failure this restructure invites, where the sim keeps using one number for two jobs
  // and half the ladder silently does nothing.
  // -------------------------------------------------------------------------------------------

  /** Ticks the first burst lasted, and ticks the first silence lasted. */
  function cycle(id: WeaponId, tier: number): { burst: number; cool: number; stats: WeaponStats } {
    const w = makeWorld(id);
    addEnemy(w, 100, 0, TOUGH_HP);
    setTier(w, tier);
    const stats = w.weapons[0].stats;
    const burstSec = stats.heatCapacity / stats.heatPerSec;
    const coolSec = (stats.heatCapacity - stats.heatResume) / stats.heatDispersion;
    const b = burnWorld(w, Math.ceil((burstSec + coolSec) * TICK_RATE) + 10);
    expect(b.overheats.length).toBeGreaterThanOrEqual(1);
    expect(b.resumes.length).toBeGreaterThanOrEqual(1);
    return { burst: b.overheats[0] + 1, cool: b.resumes[0] - b.overheats[0], stats };
  }

  it('sustains a proportionally LONGER burst when capacity goes up, at the same heat rate', () => {
    // T3 is the short laser's first capacity tier and changes nothing else, so the burst has to
    // grow by exactly the capacity ratio: same climb rate, higher ceiling.
    const t2 = cycle('laser-short', 2);
    const t3 = cycle('laser-short', 3);

    expect(t3.stats.heatCapacity).toBeGreaterThan(t2.stats.heatCapacity);
    expect(t3.stats.heatPerSec).toBe(t2.stats.heatPerSec); // the tier bought capacity, nothing else
    expect(t3.stats.heatDispersion).toBe(t2.stats.heatDispersion);

    const ratio = t3.stats.heatCapacity / t2.stats.heatCapacity;
    expect(t3.burst / t2.burst).toBeCloseTo(ratio, 2);
    // And the bar it fills is bigger, rather than the same bar filling more slowly: the weapon
    // cuts out at ITS capacity, which is a different number than the base one.
    expect(t3.stats.heatCapacity).not.toBe(HEAT_CAPACITY_BASE);
    expect(t3.stats.heatResume).toBe(t3.stats.heatCapacity * HEAT_RESUME_FRAC);
  });

  it('cools proportionally FASTER when dispersion goes up, at the same capacity', () => {
    // T4 is the first dispersion tier. Capacity and generation are untouched, so the burst is
    // identical and only the silence shortens - which is the entire point of the stat existing
    // separately from heatPerSec.
    const t3 = cycle('laser-short', 3);
    const t4 = cycle('laser-short', 4);

    expect(t4.stats.heatDispersion).toBeGreaterThan(t3.stats.heatDispersion);
    expect(t4.stats.heatCapacity).toBe(t3.stats.heatCapacity);
    expect(t4.stats.heatPerSec).toBe(t3.stats.heatPerSec);

    expect(t4.burst).toBe(t3.burst);
    const ratio = t3.stats.heatDispersion / t4.stats.heatDispersion;
    expect(t4.cool / t3.cool).toBeCloseTo(ratio, 2);
    // Cooling that still ran at heatPerSec would make this equal, which is the bug.
    expect(t4.cool).toBeLessThan(t3.cool);
  });

  it('cuts out AT its own capacity and resumes AT its own resume line, not at 100 and 50', () => {
    const w = makeWorld('laser-medium');
    addEnemy(w, 100, 0, TOUGH_HP);
    setTier(w, WEAPON_MAX_TIER); // both capacity tiers taken: the ceiling is far off the base
    const stats = w.weapons[0].stats;
    expect(stats.heatCapacity).toBeGreaterThan(HEAT_CAPACITY_BASE);

    // Climb to the cut-out and stop exactly there.
    const burstTicks = Math.ceil((stats.heatCapacity / stats.heatPerSec) * TICK_RATE);
    for (let t = 0; t < burstTicks + 2 && !w.weapons[0].overheated; t++) tick(w);
    expect(w.weapons[0].overheated).toBe(true);
    expect(w.weapons[0].heat).toBe(stats.heatCapacity);
    // It went well past the old global ceiling on the way, and was never clamped there.
    expect(w.weapons[0].heat).toBeGreaterThan(HEAT_CAPACITY_BASE);

    // It stays out until ITS resume line - which is well ABOVE the old global 50, so a weapon
    // that came back at 50 would be firing for several seconds before this loop ends.
    const coolTicks = Math.ceil(
      ((stats.heatCapacity - stats.heatResume) / stats.heatDispersion) * TICK_RATE,
    );
    for (let t = 0; t < coolTicks + 5 && w.weapons[0].overheated; t++) {
      tick(w);
      expect(w.beams.count).toBe(0);
    }
    expect(w.weapons[0].overheated).toBe(false);
    // The unlatch happens on the first tick at or below the line, so the heat lands within one
    // tick of dispersion under it - never at the old global 50.
    expect(w.weapons[0].heat).toBeLessThanOrEqual(stats.heatResume);
    expect(w.weapons[0].heat).toBeGreaterThan(stats.heatResume - stats.heatDispersion * DT - 1e-9);
    expect(stats.heatResume).toBeGreaterThan(HEAT_CAPACITY_BASE * HEAT_RESUME_FRAC);
  });

  it('lifts sustained uptime to dispersion / (generation + dispersion)', () => {
    // The formula the ladder is built on. At tier 1 the two rates are equal and it is 1/2; a
    // dispersion tier is the ONLY thing that moves it, and a damage tier moves it the other way.
    for (const tier of [3, 4]) {
      const w = makeWorld('laser-short');
      addEnemy(w, 100, 0, TOUGH_HP);
      setTier(w, tier);
      const s = w.weapons[0].stats;
      const expected = s.heatDispersion / (s.heatPerSec + s.heatDispersion);

      const cycleTicks = Math.ceil(
        ((s.heatCapacity - s.heatResume) / s.heatPerSec +
          (s.heatCapacity - s.heatResume) / s.heatDispersion) *
          TICK_RATE,
      );
      const b = burnWorld(w, cycleTicks * 4 + Math.ceil((s.heatCapacity / s.heatPerSec) * TICK_RATE));
      expect(b.resumes.length).toBeGreaterThanOrEqual(3);
      expect(duty(b, b.resumes[0] + 1, b.resumes[2] + 1)).toBeCloseTo(expected, 2);
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe('the Cannon is untouched by any of this', () => {
  it('never heats, never emits a beam, and still spends its cooldown', () => {
    const w = makeWorld('cannon');
    const target = addEnemy(w, 100, 0, TOUGH_HP);

    ticks(w, 120); // two seconds: one banked shot plus one more
    expect(w.weapons[0].heat).toBe(0);
    expect(w.weapons[0].overheated).toBe(false);
    expect(w.beams.count).toBe(0);
    expect(w.stats.shotsFired).toBe(2);
    expect(w.weapons[0].cooldownLeft).toBeGreaterThan(0);
    expect(w.weapons[0].cooldownLeft).toBeLessThanOrEqual(CANNON.base.cooldown);
    void target;
  });

  it('still shoots the STRONGEST enemy while a laser shoots the weakest', () => {
    const w = makeWorld('cannon');
    addEnemy(w, 100, 0, 5);
    const strong = addEnemy(w, 200, 0, 900);
    sync(w);

    const n = TARGETING['highest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets, 1, 0);
    expect(n).toBe(1);
    expect(w.scratch.targets[0]).toBe(strong);
  });
});

// ---------------------------------------------------------------------------------------------

describe('progression: weapon cards unlock a slot, then level the gun in it', () => {
  /** The real catalogs, but a fixture hero so the starting weapon is under the test's control. */
  function progressionWorld(startingWeapon: WeaponId, seed = 1): World {
    const w = createWorld(
      { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      {
        heroes: [heroWith(startingWeapon)],
        weapons: WEAPON_CATALOG,
        upgrades: UPGRADE_CATALOG,
      },
    );
    w.phase = RUN_PHASE_RUNNING;
    w.player.stats.xpGain = 1;
    return w;
  }

  function gainOneLevel(world: World): void {
    world.xpBanked = (world.player.xpToNext - world.player.xp) / (world.player.stats.xpGain || 1);
    updateProgression(world, DT);
  }

  function choose(world: World, index: number): void {
    world.input.chooseIndex = index;
    updateProgression(world, DT);
    world.input.chooseIndex = -1;
  }

  function slotOf(world: World, idx: number): number {
    for (let i = 0; i < world.levelUp.offerCount; i++) {
      if (world.levelUp.offers[i] === idx) return i;
    }
    return -1;
  }

  /**
   * Levels up until `idx` is on the card and takes it. Returns false if it never appeared.
   *
   * REROLLS RATHER THAN TAKING WHATEVER IS OFFERED, and that distinction is load-bearing - it is
   * the same one hornet.test.ts documents. A hunt that blind-picks index 0 every miss fills all
   * five weapon slots and five passive slots within a dozen levels, `isOfferable` then has
   * nothing eligible left, and the hunt ends early reporting "the card never came up" when what
   * actually happened is "the deck ran dry". That failure is also SEED-COUPLED: it appears and
   * disappears when a card is added to the catalog, which is exactly how it surfaced - the Flak
   * Cannon joined the pool and this test started failing for a reason unrelated to lasers.
   *
   * Rerolling keeps the loadout to whatever the test itself fitted, which is the premise these
   * tests are built on. `infiniteRerolls` is the game's own switch for it.
   */
  function takeCard(world: World, idx: number, tries = 200): boolean {
    world.infiniteRerolls = true;
    for (let i = 0; i < tries; i++) {
      if (world.phase !== RUN_PHASE_LEVEL_UP) gainOneLevel(world);
      if (world.phase !== RUN_PHASE_LEVEL_UP) return false;
      const slot = slotOf(world, idx);
      if (slot >= 0) {
        choose(world, slot);
        return true;
      }
      choose(world, CHOOSE_REROLL);
    }
    return false;
  }

  it('installs the gun in the next free slot and it starts firing', () => {
    const w = progressionWorld('cannon', 7);
    expect(w.weaponCount).toBe(1);

    const card = upgradeIndex('w-laser-long');
    expect(takeCard(w, card)).toBe(true);

    // takeCard blind-picks whatever else is offered on the way, so the slot INDEX depends on how
    // many other weapon cards happened to come up first. Find the gun rather than assuming where
    // it landed - the contract is "it is installed and live", not "it is at index 1".
    expect(w.weaponCount).toBeGreaterThanOrEqual(2);
    let slotIdx = -1;
    for (let i = 0; i < w.weaponCount; i++) {
      if (w.weapons[i].defId === weaponDefIndex('laser-long')) slotIdx = i;
    }
    expect(slotIdx).toBeGreaterThan(0);
    const inst = w.weapons[slotIdx];
    expect(inst.defId).toBe(weaponDefIndex('laser-long'));
    expect(inst.level).toBe(1);
    expect(inst.heat).toBe(0);
    expect(inst.overheated).toBe(false);
    expect(inst.cooldownLeft).toBe(0);
    expect(inst.targetDense).toBe(-1);
    // resolveWeaponStats ran for the new slot: without it, range would still be 0.
    expect(inst.stats.damage).toBe(LASER_LONG.base.damage);
    expect(inst.stats.range).toBe(LASER_LONG.base.range);
    expect(inst.stats.rangeSq).toBe(LASER_LONG.base.range * LASER_LONG.base.range);
    expect(inst.stats.heatPerSec).toBe(LASER_LONG.base.heatPerSec);

    // And it is live in the pipeline, not just present in the array.
    //
    // ONE BODY PER SLOT, not one body. Lasers no longer double up - a body another laser has
    // already claimed this tick is skipped - so a single enemy on the field is burned by whichever
    // laser sits in the lowest slot and every other laser correctly idles. `takeCard` blind-picks
    // its way here and may well have installed a second beam, so a one-enemy fixture would be
    // asserting that the new rule does not work.
    w.phase = RUN_PHASE_RUNNING;
    const target = addEnemy(w, 300, 0, TOUGH_HP); // past the Cannon's 260, inside the laser's 430
    for (let i = 1; i < w.weaponCount; i++) addEnemy(w, 300, i * 40, TOUGH_HP);
    ticks(w, 30);
    // Other guns picked up on the way may also be firing, so assert THIS laser produced a beam
    // rather than that it was the only thing on the field.
    let sawBeam = false;
    for (let i = 0; i < w.beams.count; i++) {
      if (w.beams.weaponIdx[i] === slotIdx) sawBeam = true;
    }
    expect(sawBeam).toBe(true);
    expect(w.enemies.hp[target]).toBeLessThan(TOUGH_HP);
    expect(w.weapons[slotIdx].heat).toBeGreaterThan(0);
  });

  it('Radiator Bank is never offered while the loadout holds no laser', () => {
    const w = progressionWorld('cannon', 11);
    const radiator = upgradeIndex('p-radiator');
    const isLaserCard = (idx: number): boolean => {
      const grants = w.upgradeCatalog[idx].grantsWeapon;
      return grants === 'laser-short' || grants === 'laser-medium' || grants === 'laser-long';
    };

    for (let i = 0; i < 25; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break; // pool exhausted or run over - nothing left to check
      for (let s = 0; s < w.levelUp.offerCount; s++) {
        expect(w.levelUp.offers[s], `level-up ${i}`).not.toBe(radiator);
      }
      // Close the card WITHOUT ever taking a laser, so the premise this loop is built on - a
      // loadout holding none - stays true going into the next level-up too.
      let safe = 0;
      for (let s = 0; s < w.levelUp.offerCount; s++) {
        if (!isLaserCard(w.levelUp.offers[s])) {
          safe = s;
          break;
        }
      }
      choose(w, safe);
    }

    for (let i = 0; i < w.weaponCount; i++) {
      expect(isLaserCard(upgradeIndexForWeapon(w.weaponCatalog[w.weapons[i].defId].id))).toBe(
        false,
      );
    }
  });

  it('Radiator Bank is offered once the loadout holds a laser, and can be taken', () => {
    const w = progressionWorld('cannon', 21);
    // Fitted by hand, the same way `twoLaserWorld` does below - the gate cares about what is
    // HELD, not about how it got there, so earning the laser through a dozen level-ups would put
    // the upgrade RNG between the setup and the assertion for no reason.
    const inst = w.weapons[w.weaponCount];
    inst.defId = weaponDefIndex('laser-short');
    inst.level = 1;
    w.weaponCount++;

    const radiator = upgradeIndex('p-radiator');
    expect(takeCard(w, radiator, 300)).toBe(true);
    expect(w.levelUp.stacks[radiator]).toBe(1);
  });

  it('starts the hero gun at tier 1 and offers its card as TIER 2, never as an unlock', () => {
    // The hero STARTS with the short laser and never chose a card for it, so `stacks` is seeded
    // at run start. Without that seed the card would come back as an unlock and taking it would
    // either install a second copy or set a gun that has been firing since t=0 back to tier 1.
    const w = progressionWorld('laser-short', 3);
    const own = upgradeIndex('w-laser-short');
    const defId = weaponDefIndex('laser-short');

    expect(w.levelUp.stacks[own]).toBe(1);
    expect(w.weaponCount).toBe(1);
    expect(w.weapons[0].defId).toBe(defId);
    expect(w.weapons[0].level).toBe(1);

    let sawOwnCard = false;
    for (let i = 0; i < 40; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      const slot = slotOf(w, own);
      if (slot >= 0) {
        // Whenever it IS offered it is offered as the next tier up, which is at least 2.
        expect(w.levelUp.stacks[own]).toBeGreaterThanOrEqual(1);
        sawOwnCard = true;
        choose(w, slot);
        // Taken as a tier: the same single instance, one level higher. Never a second copy.
        expect(w.weapons[0].level).toBe(w.levelUp.stacks[own]);
        expect(w.weapons[0].level).toBeGreaterThanOrEqual(2);
        let held = 0;
        for (let s = 0; s < w.weaponCount; s++) if (w.weapons[s].defId === defId) held++;
        expect(held).toBe(1);
        continue;
      }
      choose(w, 0);
    }
    expect(sawOwnCard).toBe(true);
  });

  it('levels the gun it already holds instead of installing a second copy', () => {
    const w = progressionWorld('cannon', 5);
    const card = upgradeIndex('w-laser-medium');
    expect(takeCard(w, card)).toBe(true);

    // Which slot it landed in is a function of what else the blind picks unlocked on the way, so
    // the slot is looked up rather than assumed.
    const defId = weaponDefIndex('laser-medium');
    const countBefore = w.weaponCount;
    let slotHoldingIt = -1;
    for (let i = 0; i < w.weaponCount; i++) if (w.weapons[i].defId === defId) slotHoldingIt = i;
    expect(slotHoldingIt).toBeGreaterThanOrEqual(0);
    expect(w.weapons[slotHoldingIt].level).toBe(1);

    // Take the SAME card again, however many levels it takes to come round.
    expect(takeCard(w, card)).toBe(true);
    expect(w.weaponCount).toBeGreaterThanOrEqual(countBefore);

    expect(w.levelUp.stacks[card]).toBe(2);
    expect(w.weapons[slotHoldingIt].level).toBe(2);
    // Still exactly one slot holds it, and the loadout did not grow.
    let held = 0;
    for (let i = 0; i < w.weaponCount; i++) if (w.weapons[i].defId === defId) held++;
    expect(held).toBe(1);
    // Tier 2 of the medium laser is damage + heat, and both moved.
    expect(w.weapons[slotHoldingIt].stats.damage).toBeGreaterThan(LASER_MEDIUM.base.damage);
    expect(w.weapons[slotHoldingIt].stats.heatPerSec).toBeGreaterThan(
      LASER_MEDIUM.base.heatPerSec,
    );
  });

  it('stops offering UNLOCKS once every slot is full, and keeps offering tiers', () => {
    const w = progressionWorld('cannon', 9);
    // Fill the loadout. The catalog only has four guns, so the slots are filled directly - the
    // cap is about MAX_WEAPONS, not about how many distinct guns exist this month.
    for (let i = 1; i < MAX_WEAPONS; i++) {
      w.weapons[i].defId = i % WEAPON_CATALOG.length;
      w.weapons[i].level = 1;
    }
    w.weaponCount = MAX_WEAPONS;

    let sawTierOffer = false;
    for (let i = 0; i < 30; i++) {
      gainOneLevel(w);
      if (w.phase !== RUN_PHASE_LEVEL_UP) break;
      for (let s = 0; s < w.levelUp.offerCount; s++) {
        const idx = w.levelUp.offers[s];
        // With the weapon slots full, an UNLOCK of a NEW GUN can never be offered. Passives are
        // a separate pool with their own cap, so a passive unlock is still legitimate here - the
        // assertion is about weapon slots, not about every card in the game.
        const def = w.upgradeCatalog[idx];
        if (def.kind === 'weapon') {
          expect(w.levelUp.stacks[idx]).toBeGreaterThan(0);
          sawTierOffer = true;
        }
      }
      choose(w, 0);
    }
    expect(sawTierOffer).toBe(true);
    expect(w.weaponCount).toBe(MAX_WEAPONS);
  });

  it('installs the unlocked gun at tier 1 with its card seeded to one stack', () => {
    const w = progressionWorld('cannon', 7);
    const card = upgradeIndexForWeapon('laser-long');
    expect(card).toBe(upgradeIndex('w-laser-long'));
    expect(w.levelUp.stacks[card]).toBe(0); // not held: the card is an UNLOCK

    expect(takeCard(w, card)).toBe(true);
    expect(w.levelUp.stacks[card]).toBe(1);
    const inst = w.weapons[w.weaponCount - 1];
    expect(inst.defId).toBe(weaponDefIndex('laser-long'));
    expect(inst.level).toBe(1);
    // Tier 1 is the base weapon, so the ladder has not been applied to it yet.
    expect(inst.stats.damage).toBe(LASER_LONG.base.damage);
    expect(inst.stats.heatCapacity).toBe(LASER_LONG.base.heatCapacity);
  });
});

// ---------------------------------------------------------------------------------------------

describe('determinism with lasers in the loadout', () => {
  /** Deterministic, input-only movement: no RNG, no clock, just a function of the tick index. */
  function inputAt(t: number): InputFrame {
    return {
      moveX: ((t * 7) % 255) - 127,
      moveY: ((t * 13) % 255) - 127,
      buttons: 0,
      // Always take the first card, the moment one is offered.
      chooseIndex: 0,
    };
  }

  function runHashes(startingWeapon: WeaponId, seed: number, steps: number): number[] {
    const world = createWorld(
      { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      {
        heroes: [heroWith(startingWeapon)],
        weapons: WEAPON_CATALOG,
        upgrades: UPGRADE_CATALOG,
      },
    );
    const out: number[] = [];
    for (let t = 0; t < steps; t++) {
      stepWorld(world, inputAt(t));
      if (t % 250 === 249) out.push(hashWorld(world));
    }
    out.push(hashWorld(world));
    return out;
  }

  it('produces an identical hash chain for the same seed and inputs', () => {
    const a = runHashes('laser-long', 20260813, 1500);
    const b = runHashes('laser-long', 20260813, 1500);
    expect(a).toEqual(b);
    // The run actually did something - a chain of identical zeros would prove nothing.
    expect(new Set(a).size).toBeGreaterThan(1);
  });

  it('two worlds stepped alternately in one process do not contaminate each other', () => {
    // The beam path keeps its tick-local context at module scope (see BEAM in weapons.ts). If any
    // of it leaked between worlds, interleaving the steps is what would expose it.
    const solo = runHashes('laser-medium', 4242, 900);

    const w1 = createWorld(
      { seed: 4242, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      {
        heroes: [heroWith('laser-medium')],
        weapons: WEAPON_CATALOG,
        upgrades: UPGRADE_CATALOG,
      },
    );
    const w2 = createWorld(
      { seed: 999, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      {
        heroes: [heroWith('laser-short')],
        weapons: WEAPON_CATALOG,
        upgrades: UPGRADE_CATALOG,
      },
    );
    const interleaved: number[] = [];
    for (let t = 0; t < 900; t++) {
      stepWorld(w1, inputAt(t));
      stepWorld(w2, inputAt(t * 3 + 1));
      if (t % 250 === 249) interleaved.push(hashWorld(w1));
    }
    interleaved.push(hashWorld(w1));

    expect(interleaved).toEqual(solo);
  });

  it('different lasers produce genuinely different runs', () => {
    const short = runHashes('laser-short', 77, 900);
    const long = runHashes('laser-long', 77, 900);
    expect(short).not.toEqual(long);
  });
});

/**
 * THE CHAIN LASER - the Medium Laser's tier 8.
 *
 * Two rules carry the whole mechanic, and both are the kind that break silently: the chain is paid
 * for out of the weapon's RANGE, and it never burns the same body twice. A regression in either
 * looks like "the laser got better" rather than like a bug, which is why they are pinned here.
 */
describe('chain laser (tier 8)', () => {
  /** Puts the held laser at `tier` and re-resolves, exactly as taking the tier would. */
  function setTier(world: World, tier: number): void {
    const inst = world.weapons[0];
    inst.level = tier;
    world.levelUp.stacks[upgradeIndexForWeapon('laser-medium')] = tier;
    resolveWeaponStats(
      world.weaponCatalog[inst.defId],
      world.heroes[world.player.heroId],
      tier,
      world.levelUp.stacks,
      world.upgradeCatalog,
      inst.stats,
    );
  }

  /** A line of stationary bodies marching east from the mech, `gap` apart. */
  function line(world: World, count: number, first: number, gap: number): void {
    for (let i = 0; i < count; i++) addEnemy(world, first + i * gap, 0, 1e6, 13);
  }

  it('spends the beam\'s range on its jumps and stops when it runs out', () => {
    const w = makeWorld('laser-medium');
    setTier(w, 8);
    line(w, 8, 120, 60);
    tick(w);

    const b = w.beams;
    expect(b.count).toBeGreaterThan(1); // it chained at all

    // Total drawn length must fit inside the weapon's range: the primary run plus every jump.
    let total = 0;
    for (let i = 0; i < b.count; i++) {
      total += Math.hypot(b.x1[i] - b.x0[i], b.y1[i] - b.y0[i]);
    }
    expect(total).toBeLessThanOrEqual(w.weapons[0].stats.range);

    // And it stopped because it ran out, not because it ran off the end of the line.
    expect(b.count).toBeLessThan(8);
  });

  it('never burns the same enemy twice in one chain', () => {
    const w = makeWorld('laser-medium');
    setTier(w, 8);
    // TWO bodies close together: a chain that did not exclude what it had already hit would
    // bounce between them until it ran out of budget.
    line(w, 2, 120, 40);
    tick(w);

    const b = w.beams;
    const seen = new Set<number>();
    for (let i = 0; i < b.count; i++) {
      if (b.enemyDense[i] === NO_BEAM_TARGET) continue;
      expect(seen.has(b.enemyDense[i])).toBe(false);
      seen.add(b.enemyDense[i]);
    }
  });

  it('publishes ONE connected run, rooted at the muzzle and ordered outwards', () => {
    // THE INVARIANT THE RENDERER LEANS ON. The beam layer draws the buffer as a polyline: entry 0
    // is the shot from the emitter and each later entry starts where the one before it stopped.
    // When the layer kept only one segment per weapon slot it drew the LAST jump alone, which on
    // screen was a loose beam hanging in the crowd with nothing joining it to the mech - so this
    // pins both halves: the order, and the joins.
    const w = makeWorld('laser-medium');
    setTier(w, 8);
    line(w, 8, 120, 60);
    tick(w);

    const b = w.beams;
    expect(b.count).toBeGreaterThan(2);

    // Entry 0 leaves the mech: within a muzzle offset of the player, not out among the bodies.
    const def = w.weaponCatalog[w.weapons[0].defId];
    const fromMech = Math.hypot(b.x0[0] - w.player.x, b.y0[0] - w.player.y);
    expect(fromMech).toBeLessThanOrEqual(def.muzzleOffset + 1e-6);

    // And every jump starts exactly where the previous segment ended.
    for (let i = 1; i < b.count; i++) {
      expect(b.x0[i]).toBeCloseTo(b.x1[i - 1], 6);
      expect(b.y0[i]).toBeCloseTo(b.y1[i - 1], 6);
    }
  });

  it('does not chain at tier 7', () => {
    const w = makeWorld('laser-medium');
    setTier(w, WEAPON_MAX_TIER);
    line(w, 8, 120, 60);
    tick(w);
    expect(w.beams.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Two lasers do not burn the same body
// ---------------------------------------------------------------------------------------------

describe('lasers spread out: a body one laser has claimed is invisible to the next', () => {
  /**
   * A world holding two beams, fitted by hand.
   *
   * By hand rather than through the card path for the same reason `setTier` exists: these tests
   * are about what the weapon system does with two lasers in two slots, and earning the second one
   * would put a dozen level-ups and the upgrade RNG between the setup and the assertion.
   */
  function twoLaserWorld(): World {
    const w = makeWorld('laser-long');
    const hero = w.heroes[w.player.heroId];
    const second = w.weapons[1];
    second.defId = weaponDefIndex('laser-medium');
    second.level = 1;
    resolveWeaponStats(
      w.weaponCatalog[second.defId],
      hero,
      1,
      w.levelUp.stacks,
      w.upgradeCatalog,
      second.stats,
    );
    w.weaponCount = 2;
    return w;
  }

  it('sends the second laser to the second-weakest rather than piling on', () => {
    const w = twoLaserWorld();
    // Two bodies, one weak. Left alone BOTH lasers pick the weak one - lowest-hp does not care
    // how far away it is.
    //
    // PLACED IN DIFFERENT DIRECTIONS, not one behind the other. A beam stops on the first body its
    // ray touches, so a collinear pair would have the second laser aim past the weak one and burn
    // it anyway - correct beam behaviour, and it would make this test pass or fail for a reason
    // that has nothing to do with target selection.
    // Fat enough that neither dies while the turrets come round - this is about who is CHOSEN.
    const weak = addEnemy(w, 200, 0, 5_000);
    const strong = addEnemy(w, 0, 200, 50_000);

    // Both turrets start pointing +x, so the one sent 90 degrees away needs a moment to lay on
    // before it fires. Target selection is settled on tick one; firing is not.
    tick(w);
    expect(w.weapons[0].targetDense).toBe(weak);
    expect(w.weapons[1].targetDense).toBe(strong);

    for (let i = 0; i < 40; i++) tick(w);
    expect(w.weapons[0].targetDense).toBe(weak);
    expect(w.weapons[1].targetDense).toBe(strong);
    // And both are now actually firing, at different bodies.
    expect(w.beams.count).toBe(2);
    expect(w.beams.enemyDense[0]).not.toBe(w.beams.enemyDense[1]);
  });

  it('leaves the surplus laser idle when there is only one body to burn', () => {
    // The stated cost of the rule: on an empty field the lasers do not double up, so the second
    // one holds no target rather than adding its damage to the first one's.
    const w = twoLaserWorld();
    const only = addEnemy(w, 200, 0, 400);
    tick(w);

    expect(w.weapons[0].targetDense).toBe(only);
    expect(w.weapons[1].targetDense).toBe(-1);
    expect(w.beams.count).toBe(1);
  });

  it('fires the pair from the two shoulder hardpoints, not the nose', () => {
    // TWO lasers held -> the symmetric side mounts. The hardpoint is the true origin, so the two
    // drawn lines start 15 u either side of the centreline while the mech faces +x at spawn.
    const w = twoLaserWorld();
    addEnemy(w, 200, 0, 400);
    addEnemy(w, 200, 60, 400);
    tick(w);

    expect(w.beams.count).toBe(2);
    const ys = [w.beams.y0[0], w.beams.y0[1]].sort((a, b) => a - b);
    expect(ys[0]).toBeCloseTo(LASER_HARDPOINTS[1].y, 6);
    expect(ys[1]).toBeCloseTo(LASER_HARDPOINTS[2].y, 6);
    expect(w.beams.x0[0]).toBeCloseTo(LASER_HARDPOINTS[1].x, 6);
  });

  it('rotates the hardpoints with the chassis facing, not with the aim', () => {
    const w = makeWorld('laser-short');
    // The mech has been walking +y: facing (0,1). The single laser's nose hardpoint swings with
    // the BODY, so it now sits 21 u up the y axis - wherever the beam itself is pointing.
    w.player.faceX = 0;
    w.player.faceY = 1;
    addEnemy(w, 100, 0, 500, 18);
    ticks(w, 30); // give the mount time to slew onto a target 90 deg off the spawn facing

    expect(w.beams.count).toBe(1);
    expect(w.beams.x0[0]).toBeCloseTo(0, 6);
    expect(w.beams.y0[0]).toBeCloseTo(LASER_HARDPOINTS[0].x, 6);
  });

  it('assigns every mount row without collision, up to five beams', () => {
    // FOUR AND FIVE BEAMS CANNOT BE REACHED THROUGH THE DECK - there are only three beam weapons,
    // and neither ascension adds one - so the loadout is fitted by hand. That is the point of the
    // test rather than a shortcut around it: BEAM_MOUNTS defines those rows, and a rule nothing
    // exercises is a rule that is wrong by the time something does.
    for (let count = 1; count <= LASER_HARDPOINTS.length; count++) {
      const w = makeWorld('laser-short');
      // Slot 0 already holds a beam; fill up to `count` with more of the same kind.
      for (let i = 1; i < count; i++) {
        const inst = w.weapons[w.weaponCount];
        inst.defId = weaponDefIndex('laser-medium');
        inst.level = 1;
        w.weaponCount++;
      }
      expect(w.weaponCount).toBe(count);

      const row = BEAM_MOUNTS[count];
      const seen = new Set<string>();
      for (let slot = 0; slot < count; slot++) {
        const hp = laserHardpoint(w, slot);
        // The mount this slot got is the one the table names for its position in the row.
        expect(hp, `count ${count} slot ${slot}`).toBe(LASER_HARDPOINTS[row[slot]]);
        seen.add(`${hp.x},${hp.y}`);
      }
      // NO TWO BEAMS SHARE A MOUNT. The whole reason the assignment exists is that two guns
      // firing from one point is indistinguishable from one gun.
      expect(seen.size, `count ${count}`).toBe(count);
    }
  });

  it('keeps every BEAM_MOUNTS row the right length and inside the table', () => {
    // The invariant the table encodes: row n has n mounts, and every entry is a real hardpoint.
    expect(BEAM_MOUNTS.length).toBe(LASER_HARDPOINTS.length + 1);
    for (let n = 0; n < BEAM_MOUNTS.length; n++) {
      expect(BEAM_MOUNTS[n].length, `row ${n}`).toBe(n);
      expect(new Set(BEAM_MOUNTS[n]).size, `row ${n} repeats a mount`).toBe(n);
      for (const idx of BEAM_MOUNTS[n]) {
        expect(idx).toBeGreaterThanOrEqual(0);
        expect(idx).toBeLessThan(LASER_HARDPOINTS.length);
      }
    }
  });

  it('puts the back pair behind the shoulders and clear of the tail', () => {
    const [nose, shoulderL, shoulderR, backL, backR] = LASER_HARDPOINTS;
    // Behind centre, and behind the shoulders - which is what makes them a BACK pair.
    expect(backL.x).toBeLessThan(0);
    expect(backL.x).toBeLessThan(shoulderL.x);
    // "Not very far back": nearer the middle than the nose is, rather than out at the exhaust.
    expect(Math.abs(backL.x)).toBeLessThan(nose.x);
    // Mirrored, on the shoulders' own lateral line.
    expect(backL.y).toBe(-backR.y);
    expect(backL.y).toBe(shoulderL.y);
    expect(backR.y).toBe(shoulderR.y);
  });

  it('hands the renderer the SAME hardpoint the ray leaves from, for every slot', () => {
    // THE CONTRACT THE EMITTER GLOW RIDES ON. `laserHardpoint` has two callers now - `fireBeam`
    // for the ray's true origin, and the render layer for where the heat glow and the cut-out
    // sputter sit while the weapon is NOT firing and there is no published beam to read. They
    // must never disagree: the render layer used to derive its own point (down the AIM vector
    // from the chassis CENTRE) and a cooling laser's glow hung in front of the nose while the
    // gun itself sat on a shoulder.
    //
    // Asserted against the PUBLISHED ORIGIN rather than against the table, so it stays true
    // through whatever the assignment rule becomes: whatever the beam leaves from, the function
    // returns - for the second slot as well as the first.
    const w = twoLaserWorld();
    addEnemy(w, 200, 0, 400);
    addEnemy(w, 200, 60, 400);
    tick(w);
    expect(w.beams.count).toBe(2);

    const fx = w.player.faceX;
    const fy = w.player.faceY;
    for (let i = 0; i < w.beams.count; i++) {
      const slot = w.beams.weaponIdx[i];
      const hp = laserHardpoint(w, slot);
      // The same body-space -> world rotation fireBeam does, and the renderer now does too.
      expect(w.beams.x0[i]).toBeCloseTo(w.player.x + hp.x * fx - hp.y * fy, 6);
      expect(w.beams.y0[i]).toBeCloseTo(w.player.y + hp.x * fy + hp.y * fx, 6);
    }
    // And the two slots genuinely got DIFFERENT mounts - otherwise this passes on a stub.
    expect(laserHardpoint(w, 0)).not.toBe(laserHardpoint(w, 1));
  });

  it('does not reserve a body for a laser that has cut out', () => {
    const w = twoLaserWorld();
    const only = addEnemy(w, 200, 0, 400);
    // Slot 0 is overheated, so it engages nothing at all - and must not hold the one body hostage
    // while the working laser beside it goes hungry.
    w.weapons[0].overheated = true;
    w.weapons[0].heat = w.weapons[0].stats.heatCapacity;
    tick(w);

    expect(w.weapons[0].targetDense).toBe(-1);
    expect(w.weapons[1].targetDense).toBe(only);
    expect(w.beams.count).toBe(1);
  });
});

// ---------------------------------------------------------------------------------------------
// Radiator Bank's unlock condition: all three lasers overheated at once
// ---------------------------------------------------------------------------------------------

describe('lasersOverheated: the latch behind Radiator Bank', () => {
  /** A world holding all three lasers, fitted by hand - see `twoLaserWorld` above for why. */
  function threeLaserWorld(): World {
    const w = createWorld(
      { seed: 1, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      { heroes: [heroWith('laser-short')], weapons: WEAPON_CATALOG, upgrades: UPGRADE_CATALOG },
    );
    w.phase = RUN_PHASE_RUNNING;
    const hero = w.heroes[w.player.heroId];
    for (const id of ['laser-medium', 'laser-long'] as const) {
      const inst = w.weapons[w.weaponCount];
      inst.defId = weaponDefIndex(id);
      inst.level = 1;
      resolveWeaponStats(w.weaponCatalog[inst.defId], hero, 1, w.levelUp.stacks, w.upgradeCatalog, inst.stats);
      w.weaponCount++;
    }
    return w;
  }

  /** Marks a weapon overheated exactly the way the real cut-out leaves it. */
  function overheat(inst: World['weapons'][number]): void {
    inst.overheated = true;
    inst.heat = inst.stats.heatCapacity;
  }

  it('latches once all three lasers are held and overheated on the same tick', () => {
    const w = threeLaserWorld();
    expect(w.weaponCount).toBe(3);
    for (let i = 0; i < w.weaponCount; i++) overheat(w.weapons[i]);

    expect(w.stats.lasersOverheated).toBe(0);
    updateWeapons(w, DT);
    expect(w.stats.lasersOverheated).toBe(1);
  });

  it('does not latch when only two of the three are overheated', () => {
    const w = threeLaserWorld();
    overheat(w.weapons[0]);
    overheat(w.weapons[1]);
    // w.weapons[2] (the long laser) stays cold.
    updateWeapons(w, DT);
    expect(w.stats.lasersOverheated).toBe(0);
  });

  it('does not latch for two overheated lasers plus a hot non-laser weapon', () => {
    // Holds the short and medium lasers plus a Cannon - never all three lasers - so this pins that
    // the condition counts WHICH weapons are overheated, not merely how many.
    const w = createWorld(
      { seed: 2, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      { heroes: [heroWith('laser-short')], weapons: WEAPON_CATALOG, upgrades: UPGRADE_CATALOG },
    );
    w.phase = RUN_PHASE_RUNNING;
    const hero = w.heroes[w.player.heroId];
    for (const id of ['laser-medium', 'cannon'] as const) {
      const inst = w.weapons[w.weaponCount];
      inst.defId = weaponDefIndex(id);
      inst.level = 1;
      resolveWeaponStats(w.weaponCatalog[inst.defId], hero, 1, w.levelUp.stacks, w.upgradeCatalog, inst.stats);
      w.weaponCount++;
    }
    overheat(w.weapons[0]);
    overheat(w.weapons[1]);
    updateWeapons(w, DT);
    expect(w.stats.lasersOverheated).toBe(0);
  });

  it('stays latched once set, even after the lasers cool back down', () => {
    const w = threeLaserWorld();
    for (let i = 0; i < w.weaponCount; i++) overheat(w.weapons[i]);
    updateWeapons(w, DT);
    expect(w.stats.lasersOverheated).toBe(1);

    for (let i = 0; i < w.weaponCount; i++) {
      w.weapons[i].overheated = false;
      w.weapons[i].heat = 0;
    }
    updateWeapons(w, DT);
    expect(w.stats.lasersOverheated).toBe(1);
  });
});
