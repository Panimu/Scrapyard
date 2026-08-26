/**
 * TARGETING - the specced rule, case by case (DESIGN.md §7.2, §12 "Targeting (Agent 4)").
 *
 * These drive the REAL pipeline stages (rebuildSpatialHash -> updateWeapons) against fixture
 * catalogs, rather than calling a comparator in isolation: the rule is only correct if it
 * survives the spatial hash, the DEAD flag and the dense/slot index split, and every one of
 * those has been the actual bug in some version of this genre.
 */

import { describe, expect, it } from 'vitest';

import { testHero } from './fixtures.js';

import { ARENA_HALF, DT, MAX_TARGETS } from '../src/core/constants.js';
import { SCENERY_CELL, SCENERY_COLS } from '../src/core/content/scenery.js';
import { DEFAULT_TUNING } from '../src/core/config/tuning.js';
import { createWorld } from '../src/core/world.js';
import {
  ENEMY_FLAG_DEAD,
  allocEnemy,
  markEnemyDead,
  type EnemyPool,
} from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import { Rng } from '../src/core/rng.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { beginTick, endTick } from '../src/core/systems/clock.js';
import { reapDead } from '../src/core/systems/reap.js';
import {
  TARGETING,
  betterHighestHp,
  gatherLiveInRange,
  targetHighestHp,
  targetNearest,
} from '../src/core/systems/targeting.js';
import { updateWeapons } from '../src/core/systems/weapons.js';
import { WEAPON_CATALOG } from '../src/core/content/weaponCatalog.js';
import { EMPTY_INPUT, type Catalogs, type World } from '../src/core/types.js';

// ---------------------------------------------------------------------------------------------
// Fixtures. A hero with EMPTY multiplier maps, so the Cannon resolves to exactly its catalog base
// numbers and every expectation below is a literal from DESIGN.md §7.3 rather than a product of
// six multipliers.
//
// This stays an explicit fixture rather than reaching for HERO_CATALOG[n]: every shipping hero is
// currently a skin with empty maps, so a catalog hero would pass today and silently start
// perturbing these expectations the moment hero variety returns.
// ---------------------------------------------------------------------------------------------

const FIXTURE_HERO = testHero();

const FIXTURE_CATALOGS: Catalogs = {
  heroes: [FIXTURE_HERO],
  weapons: WEAPON_CATALOG,
  upgrades: [],
};

/** Archetype id for a grunt. A literal so this suite does not depend on the enemy catalog at
 *  all - targeting reads hp, position and spawnId, and nothing else. */
const ARCH_GRUNT = 1;

function makeWorld(seed = 1): World {
  const w = createWorld(
    { seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING },
    FIXTURE_CATALOGS,
  );
  // AN EMPTY YARD. Target selection skips bodies it has no line of sight to, so a world with
  // scrap standing in it would make these tests about which enemies happened to be behind a
  // wreck rather than about the ORDERING RULE, which is the whole subject of this file. The
  // occlusion behaviour has its own test below, where it is the thing being asserted rather than
  // a confound. Same reasoning as `movement.test.ts`.
  if (w.scenery.kind !== 'piles') throw new Error('expected the Scrapyard');
  w.scenery.radius.fill(0);
  w.scenery.count = 0;
  return w;
}

/**
 * Places one enemy and returns its DENSE index (allocEnemy appends, so it is count - 1).
 * spawnIds come from the director's monotonic counter exactly as the real spawner does, so
 * "lower id" in a tie-break means "spawned earlier" here too.
 */
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

/**
 * Runs the pipeline stages this agent owns, in their real order and with the real DT:
 *   S5 rebuildSpatialHash -> S6 updateWeapons -> S12 reapDead.
 * Spawning, collision and damage are deliberately absent - they belong to other systems, and
 * excluding them is what makes a failure here unambiguously a targeting/weapon failure.
 */
function tick(world: World): void {
  beginTick(world, EMPTY_INPUT);
  rebuildSpatialHash(world.spatial, world.enemies);
  updateWeapons(world, DT);
  reapDead(world);
  endTick(world);
}

/** Refreshes the hash without advancing time, for tests that call a strategy directly. */
function sync(world: World): void {
  rebuildSpatialHash(world.spatial, world.enemies);
}

function spawnIdOf(e: EnemyPool, dense: number): number {
  return e.spawnId[dense];
}

// ---------------------------------------------------------------------------------------------

describe('the specced rule: highest CURRENT hp within range', () => {
  it('picks the 90 HP enemy over the 10 and the 50, regardless of distance', () => {
    const w = makeWorld();
    // The 10 HP enemy is the NEAREST and the 90 HP one is the FURTHEST - the arrangement that
    // makes a nearest-target implementation pass a naive test and fail this one.
    addEnemy(w, 60, 0, 10);
    const far90 = addEnemy(w, 250, 0, 90);
    addEnemy(w, 150, 0, 50);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    // A LITERAL RADIUS, like every other case in this file. It used to read CANNON.base.range,
    // which quietly coupled a targeting test to a balance number: trimming the Cannon's reach put
    // the 250 u body outside the radius and failed a test that is not about the Cannon at all.
    const n = targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0);

    expect(n).toBe(1);
    expect(out[0]).toBe(far90);
  });

  it('falls back to the 50 once the 90 leaves range, and back again when it returns', () => {
    const w = makeWorld();
    addEnemy(w, 60, 0, 10);
    const far90 = addEnemy(w, 250, 0, 90);
    const mid50 = addEnemy(w, 150, 0, 50);
    const out = new Int32Array(MAX_TARGETS);
    const rangeSq = 260 * 260;

    sync(w);
    expect(targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(far90);

    // 300 u > 260 u range.
    w.enemies.x[far90] = 300;
    sync(w);
    expect(targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(mid50);

    w.enemies.x[far90] = 250;
    sync(w);
    expect(targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(far90);
  });

  it('treats the range as inclusive at exactly 260 u and exclusive just beyond', () => {
    const w = makeWorld();
    const e = addEnemy(w, 260, 0, 90);
    const out = new Int32Array(MAX_TARGETS);
    const rangeSq = 260 * 260;

    sync(w);
    expect(targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(e);

    w.enemies.x[e] = 260.5;
    sync(w);
    expect(targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0)).toBe(0);
  });

  it('returns nothing when the only enemies are out of range', () => {
    const w = makeWorld();
    addEnemy(w, 400, 0, 500);
    addEnemy(w, 0, -900, 500);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(0);
  });
});

describe('tie-breaks - a strict total order, so hash visit order cannot matter', () => {
  it('equal HP: the nearer enemy wins', () => {
    const w = makeWorld();
    const far = addEnemy(w, 240, 0, 90);
    const near = addEnemy(w, 120, 0, 90);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(near);
    expect(betterHighestHp(w.enemies, near, far, 0, 0)).toBe(true);
    expect(betterHighestHp(w.enemies, far, near, 0, 0)).toBe(false);
  });

  it('equal HP and exactly equal distance: the lower spawnId wins', () => {
    const w = makeWorld();
    // Mirrored about the origin: dist^2 is bit-identical, so key 3 is the ONLY discriminator.
    const first = addEnemy(w, 150, 0, 90);
    const second = addEnemy(w, -150, 0, 90);
    expect(spawnIdOf(w.enemies, first)).toBeLessThan(spawnIdOf(w.enemies, second));
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(first);
    expect(betterHighestHp(w.enemies, first, second, 0, 0)).toBe(true);
    expect(betterHighestHp(w.enemies, second, first, 0, 0)).toBe(false);
  });

  it('is irreflexive and antisymmetric, so the order can never cycle', () => {
    const w = makeWorld();
    const a = addEnemy(w, 100, 0, 90);
    const b = addEnemy(w, 100, 0, 90); // identical position and HP; only spawnId differs
    const e = w.enemies;

    expect(betterHighestHp(e, a, a, 0, 0)).toBe(false);
    expect(betterHighestHp(e, b, b, 0, 0)).toBe(false);
    expect(betterHighestHp(e, a, b, 0, 0)).toBe(true);
    expect(betterHighestHp(e, b, a, 0, 0)).toBe(false);
  });
});

describe('deferred reaping - a corpse must never absorb a 1.2 s cooldown', () => {
  it('skips an enemy marked dead earlier in the same tick', () => {
    const w = makeWorld();
    const big = addEnemy(w, 200, 0, 400);
    const small = addEnemy(w, 100, 0, 40);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(big);

    // Killed by an earlier stage this tick: still in the pool AND still in the hash until S12.
    markEnemyDead(w.enemies, big);
    expect(w.enemies.flags[big] & ENEMY_FLAG_DEAD).toBe(ENEMY_FLAG_DEAD);
    expect(w.enemies.count).toBe(2);

    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(small);
  });

  it('does not fire the Cannon at a corpse', () => {
    const w = makeWorld();
    const big = addEnemy(w, 200, 0, 400);
    sync(w);
    markEnemyDead(w.enemies, big);

    updateWeapons(w, DT);

    expect(w.weapons[0].targetDense).toBe(-1);
    expect(w.stats.shotsFired).toBe(0);
    // And the cooldown was not consumed by the corpse.
    expect(w.weapons[0].cooldownLeft).toBeLessThanOrEqual(0);
  });
});

describe('top-K selection', () => {
  it('returns the K best in order, with no duplicates', () => {
    const w = makeWorld();
    const a = addEnemy(w, 200, 0, 300);
    const b = addEnemy(w, 60, 0, 250);
    const c = addEnemy(w, 0, 140, 120);
    const d = addEnemy(w, -100, 0, 40);
    addEnemy(w, 30, 30, 5);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    const n = targetHighestHp(w, 0, 0, 260 * 260, 4, out, 1, 0);

    expect(n).toBe(4);
    expect(Array.from(out.slice(0, 4))).toEqual([a, b, c, d]);
    expect(new Set(Array.from(out.slice(0, n))).size).toBe(n);
  });

  it('returns fewer than K when fewer enemies are in range', () => {
    const w = makeWorld();
    const a = addEnemy(w, 100, 0, 90);
    const b = addEnemy(w, 200, 0, 30);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 5, out, 1, 0)).toBe(2);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('clamps wantCount to the length of the output buffer', () => {
    const w = makeWorld();
    for (let i = 0; i < 12; i++) addEnemy(w, 40 + i * 10, 0, 100 + i);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 99, out, 1, 0)).toBe(MAX_TARGETS);
  });

  it('returns 0 for a wantCount of 0 without touching the buffer', () => {
    const w = makeWorld();
    addEnemy(w, 100, 0, 90);
    sync(w);

    const out = new Int32Array(MAX_TARGETS).fill(-7);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 0, out, 1, 0)).toBe(0);
    expect(out[0]).toBe(-7);
  });
});

describe('the strategy seam - weapons 2..12 need no firing-loop edits', () => {
  it('exposes both strategies under their data ids', () => {
    expect(TARGETING['highest-hp']).toBe(targetHighestHp);
    expect(TARGETING.nearest).toBe(targetNearest);
    expect(Object.isFrozen(TARGETING)).toBe(true);
  });

  it('nearest picks a different enemy from highest-hp on the same set', () => {
    const w = makeWorld();
    const near = addEnemy(w, 50, 0, 10);
    const far = addEnemy(w, 250, 0, 90);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetHighestHp(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(far);
    expect(targetNearest(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(near);
  });

  it('nearest breaks exact distance ties by higher HP, then lower spawnId', () => {
    const w = makeWorld();
    const weak = addEnemy(w, 100, 0, 20);
    const strong = addEnemy(w, -100, 0, 80);
    sync(w);

    const out = new Int32Array(MAX_TARGETS);
    expect(targetNearest(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(strong);

    w.enemies.hp[strong] = 20; // now identical on both keys 1 and 2
    sync(w);
    expect(targetNearest(w, 0, 0, 260 * 260, 1, out, 1, 0)).toBe(1);
    expect(out[0]).toBe(weak); // lower spawnId
  });
});

describe('the broad phase - hash query, never a pool scan', () => {
  it('matches a brute-force argmax over the whole pool, across 200 random configurations', () => {
    const rng = new Rng(0xc0ffee);
    const out = new Int32Array(MAX_TARGETS);
    const rangeSq = 260 * 260;

    for (let iter = 0; iter < 200; iter++) {
      const w = makeWorld(iter + 1);
      const count = 1 + rng.nextInt(60);
      for (let i = 0; i < count; i++) {
        // Deliberately spread well past the range so most candidates must be rejected, and
        // quantised to a coarse grid so exact ties on distance and HP happen often.
        const x = rng.nextInt(17) * 40 - 320;
        const y = rng.nextInt(17) * 40 - 320;
        const hp = rng.nextInt(6) * 25 + 5;
        const d = addEnemy(w, x, y, hp);
        // Kill a fifth of them: corpses linger in the pool and the hash until S12.
        if (rng.nextInt(5) === 0) markEnemyDead(w.enemies, d);
      }
      sync(w);

      // Reference implementation: linear scan, same total order, no spatial structure at all.
      const e = w.enemies;
      let best = -1;
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        if (e.x[d] * e.x[d] + e.y[d] * e.y[d] > rangeSq) continue;
        if (best === -1 || betterHighestHp(e, d, best, 0, 0)) best = d;
      }

      const n = targetHighestHp(w, 0, 0, rangeSq, 1, out, 1, 0);
      if (best === -1) {
        expect(n).toBe(0);
      } else {
        expect(n).toBe(1);
        expect(out[0]).toBe(best);
      }
    }
  });

  it('gathers exactly the live in-range set, with no duplicates', () => {
    const rng = new Rng(0x5eed);
    const rangeSq = 200 * 200;

    for (let iter = 0; iter < 100; iter++) {
      const w = makeWorld(iter + 1);
      const count = 1 + rng.nextInt(50);
      for (let i = 0; i < count; i++) {
        const d = addEnemy(w, rng.nextRange(-400, 400), rng.nextRange(-400, 400), 10 + i);
        if (rng.nextInt(4) === 0) markEnemyDead(w.enemies, d);
      }
      sync(w);

      const buf = new Uint16Array(w.scratch.candidates.length);
      const n = gatherLiveInRange(w, 0, 0, rangeSq, buf);
      const got = Array.from(buf.slice(0, n)).sort((a, b) => a - b);

      const e = w.enemies;
      const expected: number[] = [];
      for (let d = 0; d < e.count; d++) {
        if ((e.flags[d] & ENEMY_FLAG_DEAD) !== 0) continue;
        if (e.x[d] * e.x[d] + e.y[d] * e.y[d] <= rangeSq) expected.push(d);
      }

      expect(got).toEqual(expected);
      expect(new Set(got).size).toBe(got.length);
    }
  });

  it('is unaffected by which cell an enemy lands in - a 1 000 u walk changes nothing', () => {
    // Same relative geometry, translated far enough to change every cell coordinate and every
    // bucket. A grid-origin bug would show up here and nowhere else.
    const relative = [
      { x: 60, y: 0, hp: 10 },
      { x: 250, y: 0, hp: 90 },
      { x: 150, y: 0, hp: 50 },
    ];
    const out = new Int32Array(MAX_TARGETS);

    for (const origin of [
      { x: 0, y: 0 },
      { x: 1000, y: -1000 },
      { x: -31337, y: 27183 },
    ]) {
      const w = makeWorld();
      w.player.x = origin.x;
      w.player.y = origin.y;
      const dense = relative.map((r) => addEnemy(w, origin.x + r.x, origin.y + r.y, r.hp));
      sync(w);

      const n = targetHighestHp(w, origin.x, origin.y, 260 * 260, 1, out, 1, 0);
      expect(n).toBe(1);
      expect(out[0]).toBe(dense[1]);
    }
  });
});

describe('the rule, end to end through updateWeapons', () => {
  it('aims the turret at the highest-HP enemy and re-evaluates every tick', () => {
    const w = makeWorld();
    const weak = addEnemy(w, 0, 100, 40);
    // BOTH INSIDE THE CANNON'S ACQUISITION WINDOW, which is 70% of its 240 reach - 168, not 240.
    // The distances are scaffolding here (this is about the rule re-evaluating on CURRENT hp) and
    // a body the turret will not CHOOSE is not a candidate at all. See WeaponDef.acquireFrac.
    const strong = addEnemy(w, 0, -150, 200);

    tick(w);
    expect(w.weapons[0].targetDense).toBe(strong);

    // Chip the strong one below the weak one mid-flight: the rule is CURRENT hp, so the turret
    // must swing away on the very next tick. No lock, no hysteresis.
    w.enemies.hp[strong] = 10;
    tick(w);
    expect(w.weapons[0].targetDense).toBe(weak);
  });

  it('leaves targetDense at -1 and fires nothing when the horde is out of range', () => {
    const w = makeWorld();
    addEnemy(w, 500, 0, 900);
    for (let i = 0; i < 30; i++) tick(w);

    expect(w.weapons[0].targetDense).toBe(-1);
    expect(w.stats.shotsFired).toBe(0);
    expect(w.projectiles.count).toBe(0);
  });

  /**
   * LINE OF SIGHT. Weapons fire in a straight line and everything that stops a round stops it
   * before it arrives, so a body behind cover is not a hard shot - it is one that cannot land.
   * Picking it wastes a cooldown, and for the lasers it is worse: they refuse an obstructed shot,
   * so a laser locked onto an occluded body sits idle with a full heat bar while things it can
   * see walk past.
   */
  describe('line of sight', () => {
    /**
     * One pile at (x, y).
     *
     * WRITTEN TO THE CELL ITS POSITION FALLS IN, not to slot 0. The yard is a jittered GRID and
     * every query indexes it by coordinate - a pile parked in the wrong slot is invisible to the
     * ray, which is exactly how the first version of this test passed while asserting nothing.
     */
    function putPile(w: World, x: number, y: number, radius: number): void {
      if (w.scenery.kind !== 'piles') throw new Error('expected the Scrapyard');
      const col = Math.floor((x + ARENA_HALF) / SCENERY_CELL);
      const row = Math.floor((y + ARENA_HALF) / SCENERY_CELL);
      const i = row * SCENERY_COLS + col;
      w.scenery.x[i] = x;
      w.scenery.y[i] = y;
      w.scenery.radius[i] = radius;
      // Variant 0 (crushed cars) rather than the barrel: barrels are deliberately transparent to
      // the ray queries, so using one here would assert nothing.
      w.scenery.variant[i] = 0;
      w.scenery.count = 1;
    }

    it('does not target a body hidden behind scenery', () => {
      const w = makeWorld();
      // THE PILE AND THE BODY BOTH HAVE TO FIT INSIDE 168 - the Cannon's acquisition window, 70%
      // of its 240 reach. A pile at 120 with radius 60 reaches out to 180, so nothing could be
      // both behind it and choosable, and this test would have passed on a build with the
      // occlusion check ripped out entirely. Smaller and nearer: the pile spans x 40..120 and the
      // body sits at 160, behind it and comfortably inside the window.
      putPile(w, 80, 0, 40);
      const hidden = addEnemy(w, 160, 0, 900);
      // `sync` FIRST. gather reads the spatial hash, so without a rebuild it returns 0 for an
      // enemy that is simply not in the hash yet - and the assertion would pass on a build with
      // no occlusion test at all.
      sync(w);
      expect(gatherLiveInRange(w, 0, 0, 260 * 260, new Uint16Array(MAX_TARGETS * 4))).toBe(0);

      for (let i = 0; i < 30; i++) tick(w);
      expect(w.weapons[0].targetDense).toBe(-1);
      expect(w.stats.shotsFired).toBe(0);
      // The body is alive and in range - it is only unreachable.
      expect(w.enemies.hp[hidden]).toBe(900);
    });

    it('picks a visible body over a hidden one, even when the hidden one is the better target', () => {
      const w = makeWorld();
      // Behind the pile AND inside the 168 acquisition window - see the test above for why both
      // halves matter.
      putPile(w, 80, 0, 40);
      // The Cannon wants the HIGHEST hp. The hidden body wins that comparison outright, so if it
      // is still a candidate it will be chosen and this test fails on the value of targetDense.
      addEnemy(w, 160, 0, 5000);
      const visible = addEnemy(w, 0, 150, 100);

      for (let i = 0; i < 30; i++) tick(w);
      // The CHOICE is the contract here, not the shot: the visible body is at 90 degrees, and the
      // turret has neither finished traversing onto it nor come off cooldown in 30 ticks.
      expect(w.weapons[0].targetDense).toBe(visible);
    });

    it('still targets a body whose own edge is clear of the obstruction', () => {
      const w = makeWorld();
      // Off to one side, so the line to the enemy misses it entirely.
      putPile(w, 120, 200, 60);
      const seen = addEnemy(w, 150, 0, 900);

      for (let i = 0; i < 30; i++) tick(w);
      expect(w.weapons[0].targetDense).toBe(seen);
    });
  });
});
