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

import {
  DT,
  HEAT_CAPACITY_BASE,
  HEAT_RESUME_FRAC,
  MAX_WEAPONS,
  TICK_RATE,
} from '../src/core/constants.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import {
  CANNON,
  LASER_LONG,
  LASER_MEDIUM,
  LASER_SHORT,
  WEAPON_CATALOG,
  weaponDefIndex,
  type WeaponDef,
  type WeaponId,
} from '../src/core/content/weaponCatalog.js';
import { ENEMY_CATALOG } from '../src/core/data/enemies.js';
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
  return {
    id: 'jade',
    name: 'Test Chassis',
    identity: 'fixture',
    sprite: 'mech_3dgreen',
    startingWeapon,
    player: {},
    weapon: {},
  };
}

/** No enemy catalog and no upgrades: nothing spawns, nothing levels, only the weapon runs. */
function catalogsFor(startingWeapon: WeaponId): Catalogs {
  return {
    heroes: [heroWith(startingWeapon)],
    enemies: [],
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
    expect(LASER_SHORT.base.range).toBe(150);
    expect(LASER_MEDIUM.base.range).toBe(275);
    expect(LASER_LONG.base.range).toBe(430);
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

    const n = TARGETING['lowest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets);
    expect(n).toBe(1);
    expect(w.scratch.targets[0]).toBe(weak);
  });

  it('never reaches past its own range', () => {
    const w = makeWorld('laser-short'); // range 150
    const inRange = addEnemy(w, 140, 0, 90);
    addEnemy(w, 160, 0, 1); // weaker, and 10 u too far
    sync(w);

    const n = TARGETING['lowest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets);
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

describe('the clear line: a blocked laser does not fire AT ALL', () => {
  it('refuses the shot rather than burning the blocker, then fires once the line opens', () => {
    const w = makeWorld('laser-medium'); // range 275
    const blocker = addEnemy(w, 100, 0, 500);
    const target = addEnemy(w, 200, 0, 5);

    ticks(w, 60);

    // The weakest enemy is the chosen target, so the weapon is TRYING to fire...
    expect(w.weapons[0].targetDense).toBe(target);
    // ...and nothing at all happened. Not to the target, and - the point of the test - not to
    // the body in the way either.
    expect(w.enemies.hp[target]).toBe(5);
    expect(w.enemies.hp[blocker]).toBe(500);
    expect(w.beams.count).toBe(0);
    expect(w.stats.damageDealt).toBe(0);
    expect(w.stats.kills).toBe(0);
    // A refused shot costs nothing: heat is still on the floor, so the next clear line gets a
    // full burst.
    expect(w.weapons[0].heat).toBe(0);
    expect(w.weapons[0].overheated).toBe(false);

    // Step aside. Same enemies, same hp, same target - only the geometry changed.
    w.enemies.y[blocker] = 100;
    ticks(w, 1);

    expect(w.beams.count).toBe(1);
    expect(w.beams.enemyDense[0]).toBe(target);
    expect(w.enemies.hp[target]).toBeCloseTo(5 - LASER_MEDIUM.base.damage * DT, 6);
    expect(w.enemies.hp[blocker]).toBe(500); // still untouched
    expect(w.weapons[0].heat).toBeCloseTo(LASER_MEDIUM.base.heatPerSec * DT, 9);
  });

  it('is blocked by a body that is only clipping the line, not centred on it', () => {
    const w = makeWorld('laser-medium');
    // 17 u off the axis with an 18 u radius: the circle overlaps the line by one unit.
    const blocker = addEnemy(w, 100, 17, 500, 18);
    addEnemy(w, 200, 0, 5);

    ticks(w, 30);
    expect(w.beams.count).toBe(0);
    expect(w.enemies.hp[blocker]).toBe(500);

    // 19 u off the axis with the same radius: it clears the line by a unit and the shot is on.
    w.enemies.y[blocker] = 19;
    ticks(w, 1);
    expect(w.beams.count).toBe(1);
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

  it('stops the drawn line ON the target, not through it', () => {
    const w = makeWorld('laser-short'); // muzzleOffset 22
    const target = addEnemy(w, 100, 0, 500, 18);
    ticks(w, 1);

    expect(w.beams.count).toBe(1);
    expect(w.beams.enemyDense[0]).not.toBe(NO_BEAM_TARGET);
    // Muzzle at the emitter head, endpoint at the near face of the target: 100 - 18 = 82.
    expect(w.beams.x0[0]).toBeCloseTo(22, 9);
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

  it('takes the short laser to its own capacity in exactly 10.0 s and latches there', () => {
    const w = makeWorld('laser-short');
    addEnemy(w, 100, 0, TOUGH_HP);

    // THE CEILING IS THE WEAPON'S, not a global constant. At tier 1 it is the shipping base and
    // the resume line is the documented fraction of it - which is what makes the arithmetic
    // below (10.0 s up, 5.0 s down at 10 heat/s) come out in whole seconds.
    const stats = w.weapons[0].stats;
    const cap = stats.heatCapacity;
    const resume = stats.heatResume;
    expect(cap).toBe(HEAT_CAPACITY_BASE);
    expect(resume).toBe(cap * HEAT_RESUME_FRAC);
    // Generation and dispersion START equal, and only start equal: every dispersion tier moves
    // one of them. That is why the two halves of this cycle are 10 s and 5 s here.
    // Dispersion sits BELOW generation on every laser. That asymmetry is the whole reason a beam
    // spends more of a fight cooling than firing, and it is what holds uptime under half.
    expect(stats.heatDispersion).toBeLessThan(stats.heatPerSec);

    // One tick short of the ceiling: still live, still firing, heat just under capacity.
    ticks(w, 599);
    expect(w.weapons[0].overheated).toBe(false);
    expect(w.weapons[0].heat).toBeLessThan(cap);
    expect(w.weapons[0].heat).toBeCloseTo(cap - 10 * DT, 6);
    expect(w.beams.count).toBe(1);

    // The 600th tick - 10.0 s at 10 heat/s - is the last one that fires. It delivers its damage
    // AND cuts the weapon out, which is why a full burst is exactly heatCapacity/heatPerSec
    // seconds of damage rather than one tick less.
    ticks(w, 1);
    expect(600 * DT).toBe(cap / 10);
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
      // "A little more time offline" - every laser is now under half uptime.
      expect(m.duty).toBeLessThan(0.5);
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
    ticks(w, 300); // half a burst: 50 heat
    expect(w.weapons[0].heat).toBeCloseTo(50, 6);

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

  it('cools while its line is blocked - refusing a shot buys the next burst', () => {
    const w = makeWorld('laser-medium');
    const target = addEnemy(w, 200, 0, TOUGH_HP);
    ticks(w, 60);
    expect(w.weapons[0].heat).toBeCloseTo(LASER_MEDIUM.base.heatPerSec, 5);

    // A body steps into the line. The weapon stops firing AND starts cooling - if it did not,
    // a laser would freeze at its current heat until the crowd parted.
    const blocker = addEnemy(w, 100, 0, TOUGH_HP);
    const heatWhenBlocked = w.weapons[0].heat;
    ticks(w, 30);
    expect(w.beams.count).toBe(0);
    expect(w.weapons[0].heat).toBeCloseTo(
      heatWhenBlocked - LASER_MEDIUM.base.heatDispersion * 30 * DT,
      5,
    );
    expect(w.enemies.hp[blocker]).toBe(TOUGH_HP);
    void target;
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

    const n = TARGETING['highest-hp'](w, 0, 0, w.weapons[0].stats.rangeSq, 1, w.scratch.targets);
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
        enemies: ENEMY_CATALOG,
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

  /** Levels up until `idx` is on the card and takes it. Returns false if it never appeared. */
  function takeCard(world: World, idx: number, tries = 200): boolean {
    for (let i = 0; i < tries; i++) {
      if (world.phase !== RUN_PHASE_LEVEL_UP) gainOneLevel(world);
      if (world.phase !== RUN_PHASE_LEVEL_UP) return false;
      const slot = slotOf(world, idx);
      if (slot >= 0) {
        choose(world, slot);
        return true;
      }
      choose(world, 0);
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
    expect(inst.stats.range).toBe(430);
    expect(inst.stats.rangeSq).toBe(430 * 430);
    expect(inst.stats.heatPerSec).toBe(LASER_LONG.base.heatPerSec);

    // And it is live in the pipeline, not just present in the array.
    w.phase = RUN_PHASE_RUNNING;
    const target = addEnemy(w, 300, 0, TOUGH_HP); // past the Cannon's 260, inside the laser's 430
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
        enemies: ENEMY_CATALOG,
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
        enemies: ENEMY_CATALOG,
        weapons: WEAPON_CATALOG,
        upgrades: UPGRADE_CATALOG,
      },
    );
    const w2 = createWorld(
      { seed: 999, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
      {
        heroes: [heroWith('laser-short')],
        enemies: ENEMY_CATALOG,
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
