/**
 * S8 updateCollision (detection) and S9 updateDamage (application).
 *
 * They are tested together because the interesting properties live across the seam - "pierce 2
 * hits three bodies" is a claim about a buffer S8 fills and a counter S9 decrements - but each
 * assertion names which side it is really about.
 *
 * THE MOST IMPORTANT TEST IN THIS FILE is the broad-phase property test: for 150 randomised
 * scenes, the pairs the spatial hash produces must be EXACTLY the pairs a brute-force O(n^2) scan
 * produces. A broad phase that misses a pair is a shell that visibly passes through a body; a
 * broad phase that invents one is damage from nowhere. Both are the kind of bug that only shows up
 * ten minutes into a run on a phone, and neither is findable by looking at the code.
 */

import { describe, expect, it } from 'vitest';

import { DT, GEM_SOFT_CAP } from '../src/core/constants.js';
import { DEFAULT_TUNING, gemTierForValue } from '../src/core/config/tuning.js';
import {
  ARCHETYPES,
  ARCH_BRUISER,
  ARCH_ELITE,
  ARCH_GRUNT,
  ARCH_SWARMER,
} from '../src/core/content/enemyCatalog.js';
import {
  ENEMY_FLAG_DEAD,
  allocEnemy,
  markEnemyDead,
} from '../src/core/entity/enemyPool.js';
import { NULL_HANDLE } from '../src/core/entity/handle.js';
import {
  PICKUP_FLAG_DEAD,
  PICKUP_KIND_GEM,
  allocPickup,
} from '../src/core/entity/pickupPool.js';
import {
  PROJECTILE_FLAG_DEAD,
  allocProjectile,
  markProjectileDead,
} from '../src/core/entity/projectilePool.js';
import { Rng } from '../src/core/rng.js';
import { rebuildSpatialHash } from '../src/core/spatial/hashGrid.js';
import { updateCollision } from '../src/core/systems/collision.js';
import { updateDamage } from '../src/core/systems/damage.js';
import { updatePickups } from '../src/core/systems/pickups.js';
import { reapDead } from '../src/core/systems/reap.js';
import { heroIndex } from '../src/core/data/heroes.js';
import {
  EMPTY_INPUT,
  RUN_PHASE_DEAD,
  RUN_PHASE_CHEST,
  RUN_PHASE_LEVEL_UP,
  RUN_PHASE_RUNNING,
  type World,
} from '../src/core/types.js';
import { createWorld, stepWorld } from '../src/core/world.js';

// ---------------------------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------------------------

function makeWorld(seed = 1): World {
  const w = createWorld({ seed, heroId: 0, runLengthSec: 900, tuning: DEFAULT_TUNING });
  w.phase = RUN_PHASE_RUNNING;
  return w;
}

/** Places one enemy and returns its DENSE index. spawnIds come from the director's counter. */
function addEnemy(
  world: World,
  x: number,
  y: number,
  hp: number,
  archetype = ARCH_GRUNT,
  radius = ARCHETYPES[ARCH_GRUNT].radius,
): number {
  const e = world.enemies;
  const handle = allocEnemy(e, 0, 0, archetype, x, y, world.director.nextSpawnId++);
  expect(handle).not.toBe(NULL_HANDLE);
  const d = e.count - 1;
  e.hp[d] = hp;
  e.maxHp[d] = hp;
  e.radius[d] = radius;
  e.mass[d] = ARCHETYPES[archetype].mass;
  e.speed[d] = 0;
  e.contactDamage[d] = ARCHETYPES[archetype].contactDamage;
  e.contactTimer[d] = 0;
  e.xpValue[d] = ARCHETYPES[archetype].xp;
  return d;
}

interface ShellSpec {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  damage?: number;
  pierce?: number;
  radius?: number;
  knockback?: number;
  splashRadius?: number;
  splashFrac?: number;
}

/** Places one shell and returns its DENSE index. */
function addShell(world: World, spec: ShellSpec): number {
  const p = world.projectiles;
  const handle = allocProjectile(
    p,
    spec.x,
    spec.y,
    spec.vx ?? 520,
    spec.vy ?? 0,
    10,
    0,
    0,
    ++world.stats.shotsFired,
  );
  expect(handle).not.toBe(NULL_HANDLE);
  const d = p.count - 1;
  p.damage[d] = spec.damage ?? 30;
  p.pierceLeft[d] = spec.pierce ?? 0;
  p.radius[d] = spec.radius ?? 9;
  p.knockback[d] = spec.knockback ?? 0;
  p.splashRadius[d] = spec.splashRadius ?? 0;
  p.splashFrac[d] = spec.splashFrac ?? 0;
  return d;
}

/** S5 -> S8 -> S9, the real stages in their real order. Reaping is opt-in per test. */
function detectAndApply(world: World): void {
  rebuildSpatialHash(world.spatial, world.enemies);
  updateCollision(world, DT);
  updateDamage(world, DT);
}

function clearBuffers(world: World): void {
  world.hits.count = 0;
  world.contacts.count = 0;
  world.kills.count = 0;
}

// ---------------------------------------------------------------------------------------------

describe('the broad phase - identical to brute force, on every scene', () => {
  it('produces exactly the brute-force pair set over 150 randomised scenes', () => {
    const rng = new Rng(0xb0a7);
    // Every archetype radius in the roster, so the MAX_ENEMY_RADIUS pad is genuinely exercised.
    const radii = [
      ARCHETYPES[ARCH_SWARMER].radius,
      ARCHETYPES[ARCH_GRUNT].radius,
      ARCHETYPES[ARCH_BRUISER].radius,
      ARCHETYPES[ARCH_ELITE].radius,
    ];

    for (let iter = 0; iter < 150; iter++) {
      const w = makeWorld(iter + 1);
      const e = w.enemies;
      const p = w.projectiles;

      const enemyCount = 1 + rng.nextInt(45);
      for (let i = 0; i < enemyCount; i++) {
        // A coarse grid, so exact tangency and exact distance ties happen often - those are the
        // cases a `<` vs `<=` slip gets wrong.
        const x = rng.nextInt(25) * 16 - 200;
        const y = rng.nextInt(25) * 16 - 200;
        const d = addEnemy(w, x, y, 1e6, ARCH_GRUNT, radii[rng.nextInt(radii.length)]);
        // A fifth are corpses from earlier in the tick: still in the pool and still in the hash.
        if (rng.nextInt(5) === 0) markEnemyDead(e, d);
      }

      const shellCount = 1 + rng.nextInt(12);
      for (let i = 0; i < shellCount; i++) {
        const d = addShell(w, {
          x: rng.nextInt(25) * 16 - 200,
          y: rng.nextInt(25) * 16 - 200,
          // Effectively unlimited pierce: this test is about the PAIR SET, not about how many of
          // those pairs a shell is allowed to spend a pass on.
          pierce: 120,
          radius: 4 + rng.nextInt(12),
        });
        if (rng.nextInt(6) === 0) markProjectileDead(p, d);
      }

      rebuildSpatialHash(w.spatial, w.enemies);
      updateCollision(w, DT);

      const got: string[] = [];
      for (let i = 0; i < w.hits.count; i++) {
        got.push(`${w.hits.projectileDense[i]}:${w.hits.enemyDense[i]}`);
      }
      got.sort();

      // Reference: every live shell against every live enemy, no spatial structure at all.
      const want: string[] = [];
      for (let pd = 0; pd < p.count; pd++) {
        if ((p.flags[pd] & PROJECTILE_FLAG_DEAD) !== 0) continue;
        for (let ed = 0; ed < e.count; ed++) {
          if ((e.flags[ed] & ENEMY_FLAG_DEAD) !== 0) continue;
          const dx = e.x[ed] - p.x[pd];
          const dy = e.y[ed] - p.y[pd];
          const reach = p.radius[pd] + e.radius[ed];
          if (dx * dx + dy * dy <= reach * reach) want.push(`${pd}:${ed}`);
        }
      }
      want.sort();

      expect(got).toEqual(want);
      expect(new Set(got).size).toBe(got.length);
    }
  });

  it('is unaffected by where in the world the scene sits', () => {
    // Same relative geometry, translated far enough to change every cell coordinate and bucket.
    for (const origin of [
      { x: 0, y: 0 },
      { x: 1024, y: -1024 },
      { x: -31337, y: 27183 },
    ]) {
      const w = makeWorld();
      addEnemy(w, origin.x + 20, origin.y, 100);
      addEnemy(w, origin.x, origin.y + 400, 100);
      addShell(w, { x: origin.x, y: origin.y, pierce: 5 });

      rebuildSpatialHash(w.spatial, w.enemies);
      updateCollision(w, DT);

      expect(w.hits.count).toBe(1);
      expect(w.hits.enemyDense[0]).toBe(0);
    }
  });
});

describe('pierce - how many bodies one shell is allowed', () => {
  it('pierce 0 hits exactly one enemy and is consumed', () => {
    const w = makeWorld();
    // Three bodies all overlapping the shell at once.
    addEnemy(w, 0, 0, 500);
    addEnemy(w, 12, 0, 500);
    addEnemy(w, -12, 0, 500);
    const shell = addShell(w, { x: 0, y: 0, pierce: 0, damage: 30 });

    detectAndApply(w);

    expect(w.hits.count).toBe(1);
    expect(w.projectiles.flags[shell] & PROJECTILE_FLAG_DEAD).toBe(PROJECTILE_FLAG_DEAD);

    let damagedCount = 0;
    for (let d = 0; d < w.enemies.count; d++) if (w.enemies.hp[d] < 500) damagedCount++;
    expect(damagedCount).toBe(1);
    // Nearest first: the body the shell is sitting on top of.
    expect(w.hits.enemyDense[0]).toBe(0);
  });

  it('pierce 2 hits three distinct enemies and never the same one twice', () => {
    const w = makeWorld();
    const a = addEnemy(w, 0, 0, 500);
    const b = addEnemy(w, 10, 0, 500);
    const c = addEnemy(w, -10, 0, 500);
    const d = addEnemy(w, 0, 14, 500);
    const shell = addShell(w, { x: 0, y: 0, pierce: 2, damage: 30 });

    detectAndApply(w);

    expect(w.hits.count).toBe(3);
    const hitSet = new Set<number>();
    for (let i = 0; i < w.hits.count; i++) hitSet.add(w.hits.enemyDense[i]);
    expect(hitSet.size).toBe(3);
    expect(w.projectiles.flags[shell] & PROJECTILE_FLAG_DEAD).toBe(PROJECTILE_FLAG_DEAD);

    // Exactly one of the four is untouched, and it is the furthest.
    const untouched = [a, b, c, d].filter((e) => w.enemies.hp[e] === 500);
    expect(untouched).toEqual([d]);
  });

  it('applies pierceFalloff per pass after the first', () => {
    const w = makeWorld();
    const near = addEnemy(w, 0, 0, 500);
    const mid = addEnemy(w, 10, 0, 500);
    const far = addEnemy(w, -14, 0, 500);
    addShell(w, { x: 0, y: 0, pierce: 2, damage: 30 });

    detectAndApply(w);

    const f = DEFAULT_TUNING.combat.pierceFalloff;
    expect(500 - w.enemies.hp[near]).toBeCloseTo(30, 6);
    expect(500 - w.enemies.hp[mid]).toBeCloseTo(30 * f, 6);
    expect(500 - w.enemies.hp[far]).toBeCloseTo(30 * f * f, 6);
  });

  it('does not re-hit a body it has already punched through on a later tick', () => {
    const w = makeWorld();
    // One wide body the shell will sit inside for several ticks.
    const target = addEnemy(w, 0, 0, 5000, ARCH_ELITE, ARCHETYPES[ARCH_ELITE].radius);
    addShell(w, { x: -20, y: 0, vx: 260, vy: 0, pierce: 3, damage: 30 });

    for (let t = 0; t < 10; t++) {
      clearBuffers(w);
      // Hand-integrate the shell: this test is about the hit ring, not about S7.
      if (w.projectiles.count > 0 && (w.projectiles.flags[0] & PROJECTILE_FLAG_DEAD) === 0) {
        w.projectiles.x[0] += w.projectiles.vx[0] * DT;
      }
      detectAndApply(w);
    }

    // Exactly one pass was ever spent on it, despite ~10 ticks of overlap.
    expect(5000 - w.enemies.hp[target]).toBeCloseTo(30, 6);
    expect(w.projectiles.pierceLeft[0]).toBe(2);
  });

  it('does not spend a pass on a body another shell already killed this tick', () => {
    const w = makeWorld();
    const victim = addEnemy(w, 0, 0, 10);
    const bystander = addEnemy(w, 40, 0, 500);
    addShell(w, { x: 0, y: 0, pierce: 0, damage: 30 });
    const second = addShell(w, { x: 0, y: 0, pierce: 0, damage: 30 });

    detectAndApply(w);

    expect(w.enemies.flags[victim] & ENEMY_FLAG_DEAD).toBe(ENEMY_FLAG_DEAD);
    expect(w.stats.kills).toBe(1); // one kill, one gem - double-kill dedupe
    expect(w.kills.count).toBe(1);
    // The second shell's pass was refunded rather than burned on a corpse.
    expect(w.projectiles.flags[second] & PROJECTILE_FLAG_DEAD).toBe(0);
    expect(w.enemies.hp[bystander]).toBe(500);
  });
});

describe('contact damage - gated per enemy, never by player i-frames', () => {
  /**
   * Reference model of the S8 clock / S9 rearm pair: decrement, clamp, then bill if expired.
   * `Math.fround` because the live timer is stored in a Float32Array - modelling it in float64
   * would silently disagree about the tick a cooldown lands on.
   */
  function expectedContacts(ticks: number, interval: number): number {
    const f = Math.fround;
    let timer = 0;
    let hits = 0;
    for (let t = 0; t < ticks; t++) {
      if (timer > 0) {
        timer = f(timer - DT);
        if (timer < 0) timer = 0;
      }
      if (timer <= 0) {
        hits++;
        timer = f(interval);
      }
    }
    return hits;
  }

  it('deals the exact expected total for N enemies hugging for T seconds', () => {
    const N = 5;
    const ticks = 10 * 60;

    const w = makeWorld();
    w.player.hp = 1e9; // survive the experiment; this test is about the total, not about death
    for (let i = 0; i < N; i++) {
      addEnemy(w, 8 + i, 0, 500, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);
    }

    for (let t = 0; t < ticks; t++) {
      clearBuffers(w);
      detectAndApply(w);
    }

    const arch = ARCHETYPES[ARCH_SWARMER];
    const perEnemy = expectedContacts(ticks, arch.contactInterval);
    // 0.6 s at 60 Hz is a 36-tick cadence: one bite on tick 0, then ticks 36, 72, ... The literal
    // is asserted as well as the model, so a change to either is caught by the other.
    expect(perEnemy).toBe(1 + Math.floor((ticks - 1) / 36));
    expect(w.stats.damageTaken).toBeCloseTo(N * perEnemy * arch.contactDamage, 6);
  });

  it('gives each enemy its own cooldown, so a swarmer cannot soak it for a bruiser', () => {
    const w = makeWorld();
    w.player.hp = 1e9;
    const swarmer = addEnemy(w, 8, 0, 500, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);
    const bruiser = addEnemy(w, -8, 0, 500, ARCH_BRUISER, ARCHETYPES[ARCH_BRUISER].radius);

    detectAndApply(w);
    // Both bite on the same tick. Global i-frames would have billed only one of them.
    expect(w.contacts.count).toBe(2);
    expect(w.stats.damageTaken).toBeCloseTo(
      ARCHETYPES[ARCH_SWARMER].contactDamage + ARCHETYPES[ARCH_BRUISER].contactDamage,
      6,
    );
    // Float32Array storage, so compare against the frounded interval rather than the literal.
    expect(w.enemies.contactTimer[swarmer]).toBe(
      Math.fround(ARCHETYPES[ARCH_SWARMER].contactInterval),
    );
    expect(w.enemies.contactTimer[bruiser]).toBe(
      Math.fround(ARCHETYPES[ARCH_BRUISER].contactInterval),
    );

    // Next tick: both are on their own cooldowns, so nothing is billed.
    clearBuffers(w);
    const before = w.stats.damageTaken;
    detectAndApply(w);
    expect(w.contacts.count).toBe(0);
    expect(w.stats.damageTaken).toBe(before);
  });

  it('does not bill a contact from an enemy a shell killed earlier in the same tick', () => {
    const w = makeWorld();
    const biter = addEnemy(w, 8, 0, 10, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);
    addShell(w, { x: 8, y: 0, pierce: 0, damage: 30 });

    detectAndApply(w);

    expect(w.contacts.count).toBe(1); // detection saw it - it was alive at S8
    expect(w.stats.damageTaken).toBe(0); // application refused it - it was dead by S9
    expect(w.enemies.contactTimer[biter]).toBe(0); // and its cooldown was never armed
  });

  it('kills the player and sets RUN_PHASE_DEAD exactly once', () => {
    const w = makeWorld();
    w.player.hp = 4;
    addEnemy(w, 8, 0, 500, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);
    addEnemy(w, -8, 0, 500, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);

    detectAndApply(w);

    expect(w.player.hp).toBe(0);
    expect(w.phase).toBe(RUN_PHASE_DEAD);
    // The second contact was dropped rather than driving hp negative - so damageTaken cannot
    // depend on which swarmer happened to be last in the buffer.
    expect(w.stats.damageTaken).toBe(5);
  });
});

describe('the armour formula - exact at both branches', () => {
  function billOnce(armour: number, takenMul: number, archetype: number): number {
    const w = makeWorld();
    w.player.hp = 1e9;
    w.player.stats.armour = armour;
    w.player.stats.damageTakenMul = takenMul;
    addEnemy(w, 4, 0, 500, archetype, ARCHETYPES[archetype].radius);
    detectAndApply(w);
    expect(w.contacts.count).toBe(1);
    return w.stats.damageTaken;
  }

  it('subtracts flat armour when that is above the floor (elite, 28 - 8 = 20)', () => {
    expect(ARCHETYPES[ARCH_ELITE].contactDamage).toBe(28);
    expect(billOnce(8, 1, ARCH_ELITE)).toBe(20);
  });

  it('floors at 25% of raw when armour would take more (swarmer, 5 -> 1.25)', () => {
    expect(ARCHETYPES[ARCH_SWARMER].contactDamage).toBe(5);
    expect(DEFAULT_TUNING.combat.armourMinFrac).toBe(0.25);
    // 5 - 8 = -3, so the floor wins. Armour can never heal you.
    expect(billOnce(8, 1, ARCH_SWARMER)).toBe(1.25);
  });

  it('applies damageTakenMul after the armour step, on both branches', () => {
    expect(billOnce(8, 0.5, ARCH_ELITE)).toBe(10);
    expect(billOnce(8, 0.5, ARCH_SWARMER)).toBe(0.625);
  });

  it('is a no-op at zero armour', () => {
    expect(billOnce(0, 1, ARCH_ELITE)).toBe(28);
  });
});

describe('application - kills, knockback, splash', () => {
  it('marks dead, feeds the KillFeed and never removes from the pool before S12', () => {
    const w = makeWorld();
    const target = addEnemy(w, 0, 0, 10, ARCH_GRUNT);
    addShell(w, { x: 0, y: 0, damage: 30 });

    detectAndApply(w);

    expect(w.enemies.count).toBe(1); // still in the pool: reaping is S12's job alone
    expect(w.enemies.flags[target] & ENEMY_FLAG_DEAD).toBe(ENEMY_FLAG_DEAD);
    expect(w.kills.count).toBe(1);
    expect(w.kills.xpValue[0]).toBe(ARCHETYPES[ARCH_GRUNT].xp);
    expect(w.stats.kills).toBe(1);
    expect(w.stats.killsByArchetype[ARCH_GRUNT]).toBe(1);
    // Overkill is not counted as damage dealt.
    expect(w.stats.damageDealt).toBe(10);

    reapDead(w);
    expect(w.enemies.count).toBe(0);
  });

  it('scales knockback by 1/mass and leaves anchored bodies alone', () => {
    const w = makeWorld();
    const light = addEnemy(w, 0, 0, 500, ARCH_SWARMER, ARCHETYPES[ARCH_SWARMER].radius);
    const heavy = addEnemy(w, 0, 200, 500, ARCH_ELITE, ARCHETYPES[ARCH_ELITE].radius);
    addShell(w, { x: 0, y: 0, vx: 520, vy: 0, knockback: 190 });
    addShell(w, { x: 0, y: 200, vx: 520, vy: 0, knockback: 190 });

    detectAndApply(w);

    expect(w.enemies.pushX[light]).toBeCloseTo(190 / ARCHETYPES[ARCH_SWARMER].mass, 4);
    expect(w.enemies.pushX[heavy]).toBeCloseTo(190 / ARCHETYPES[ARCH_ELITE].mass, 4);
    expect(w.enemies.pushY[light]).toBe(0);
  });

  it('splashes a fraction of the shell damage onto neighbours, but not onto the body it hit', () => {
    const w = makeWorld();
    const direct = addEnemy(w, 0, 0, 500);
    const near = addEnemy(w, 25, 0, 500);
    const outside = addEnemy(w, 120, 0, 500);
    addShell(w, { x: 0, y: 0, damage: 30, splashRadius: 34, splashFrac: 0.4 });

    detectAndApply(w);

    // The direct hit takes the full shell and nothing more.
    expect(500 - w.enemies.hp[direct]).toBeCloseTo(30, 6);
    expect(500 - w.enemies.hp[near]).toBeCloseTo(12, 6);
    expect(w.enemies.hp[outside]).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------
// S10 - updatePickups. It sits directly on the other end of the S9 seam: the KillFeed this file
// already asserts against is exactly its input, so the drop -> magnet -> bank chain is tested here
// rather than in a file that would have to re-create the kills first.
// ---------------------------------------------------------------------------------------------

describe('drops - the reward chain completes inside one tick', () => {
  it('spawns a gem on the SAME tick as the kill, at the kill position', () => {
    const w = makeWorld();
    addEnemy(w, 300, 0, 10, ARCH_GRUNT);
    addShell(w, { x: 300, y: 0, damage: 30 });

    detectAndApply(w);
    updatePickups(w, DT);

    expect(w.pickups.count).toBe(1);
    expect(w.pickups.value[0]).toBe(ARCHETYPES[ARCH_GRUNT].xp);
    expect(w.pickups.tier[0]).toBe(gemTierForValue(ARCHETYPES[ARCH_GRUNT].xp, DEFAULT_TUNING.pickups));
    expect(w.pickups.x[0]).toBeCloseTo(300, 4);
  });

  it('drops nothing for an enemy that despawned rather than died', () => {
    const w = makeWorld();
    const d = addEnemy(w, 0, 0, 500);
    markEnemyDead(w.enemies, d); // exactly what the 900 u despawn ring does - no KillFeed entry
    detectAndApply(w);
    updatePickups(w, DT);

    expect(w.kills.count).toBe(0);
    expect(w.pickups.count).toBe(0);
    expect(w.stats.kills).toBe(0);
  });
});

describe('the magnet - it chases, it does not teleport', () => {
  function placeGem(world: World, x: number, y: number, value = 1): number {
    const handle = allocPickup(
      world.pickups,
      PICKUP_KIND_GEM,
      value,
      gemTierForValue(value, DEFAULT_TUNING.pickups),
      x,
      y,
      1 + world.pickups.count,
    );
    expect(handle).not.toBe(NULL_HANDLE);
    return world.pickups.count - 1;
  }

  it('accelerates inside pickupRadius, capped at magnetMaxSpeed, and collects on arrival', () => {
    const w = makeWorld();
    const t = DEFAULT_TUNING.pickups;
    const gem = placeGem(w, w.player.stats.pickupRadius - 5, 0, 3);

    updatePickups(w, DT);
    // One tick of acceleration - not a snap to the player. (Float32Array storage, hence 4 places.)
    expect(w.pickups.vx[gem]).toBeCloseTo(-t.magnetAccel * DT, 4);
    expect(w.pickups.x[gem]).toBeGreaterThan(0);
    expect(w.xpBanked).toBe(0);

    let ticks = 1;
    while (w.pickups.count > 0 && (w.pickups.flags[gem] & PICKUP_FLAG_DEAD) === 0 && ticks < 600) {
      updatePickups(w, DT);
      const speed = Math.sqrt(w.pickups.vx[gem] ** 2 + w.pickups.vy[gem] ** 2);
      expect(speed).toBeLessThanOrEqual(t.magnetMaxSpeed + 1e-6);
      ticks++;
    }

    expect(ticks).toBeGreaterThan(3); // it took visible time to arrive
    expect(w.xpBanked).toBe(3);
    expect(w.stats.gemsCollected).toBe(1);
  });

  it('leaves a gem outside pickupRadius exactly where it lies', () => {
    const w = makeWorld();
    const gem = placeGem(w, w.player.stats.pickupRadius + 40, 0);
    for (let i = 0; i < 120; i++) updatePickups(w, DT);

    expect(w.pickups.x[gem]).toBe(w.player.stats.pickupRadius + 40);
    expect(w.pickups.vx[gem]).toBe(0);
    expect(w.xpBanked).toBe(0);
  });

  it('brings the Scraplord core in from any distance', () => {
    const w = makeWorld();
    const bossValue = DEFAULT_TUNING.pickups.gemTierValues[4];
    const gem = placeGem(w, 4000, 0, bossValue);

    for (let i = 0; i < 3600 && (w.pickups.flags[gem] & PICKUP_FLAG_DEAD) === 0; i++) {
      updatePickups(w, DT);
    }
    expect(w.xpBanked).toBe(bossValue);
  });
});

describe('gem overflow - absorbed, never dropped', () => {
  it('adds a new drop to the nearest live gem above GEM_SOFT_CAP', () => {
    const w = makeWorld();
    // Fill to the cap, well outside the magnet so nothing is collected mid-test.
    for (let i = 0; i < GEM_SOFT_CAP; i++) {
      allocPickup(w.pickups, PICKUP_KIND_GEM, 1, 0, 1000 + i * 10, 500, i + 1);
    }
    expect(w.pickups.count).toBe(GEM_SOFT_CAP);

    // A kill right next to gem 0.
    const target = addEnemy(w, 1000, 500, 10, ARCH_ELITE, ARCHETYPES[ARCH_ELITE].radius);
    addShell(w, { x: 1000, y: 500, damage: 30 });
    detectAndApply(w);
    updatePickups(w, DT);

    expect(w.enemies.flags[target] & ENEMY_FLAG_DEAD).toBe(ENEMY_FLAG_DEAD);
    // No new gem; the value landed on the nearest one and upgraded its tier.
    expect(w.pickups.count).toBe(GEM_SOFT_CAP);
    expect(w.pickups.value[0]).toBe(1 + ARCHETYPES[ARCH_ELITE].xp);
    expect(w.pickups.tier[0]).toBe(
      gemTierForValue(1 + ARCHETYPES[ARCH_ELITE].xp, DEFAULT_TUNING.pickups),
    );
    // And nothing was silently lost.
    let total = 0;
    for (let d = 0; d < w.pickups.count; d++) total += w.pickups.value[d];
    expect(total).toBe(GEM_SOFT_CAP + ARCHETYPES[ARCH_ELITE].xp);
  });
});

// ---------------------------------------------------------------------------------------------
// Damage attribution
//
// The run summary breaks `damageDealt` down by the weapon that dealt it. A breakdown is only
// worth having if it ADDS UP - a source that deals damage without crediting itself makes the
// split silently understate one weapon and the reader has no way to notice. So the invariant is
// stated once, here, and swept over chassis that between them exercise every path into
// `damageDealt`: a beam, a direct projectile hit, a splash, and a fuse detonation.
// ---------------------------------------------------------------------------------------------

describe('damage by source accounts for every point dealt', () => {
  function sumSources(w: World): number {
    let total = w.stats.damageByShield;
    for (let i = 0; i < w.stats.damageByWeapon.length; i++) total += w.stats.damageByWeapon[i];
    return total;
  }

  it('sums to damageDealt over a real run, on every damage path', () => {
    // slate  a BEAM, credited from the beam buffer's own weapon slot
    // amber  a direct projectile HIT, credited through ownerWeapon
    // fern   artillery: a fuse DETONATION whose entire output is splash
    // bone   a magazine weapon, two projectiles per burst
    for (const id of ['slate', 'amber', 'fern', 'bone'] as const) {
      const w = createWorld({
        seed: 7,
        heroId: heroIndex(id),
        runLengthSec: 900,
        tuning: DEFAULT_TUNING,
      });
      for (let t = 0; t < 60 * 90; t++) {
        const input =
          w.phase === RUN_PHASE_LEVEL_UP || w.phase === RUN_PHASE_CHEST
            ? { ...EMPTY_INPUT, chooseIndex: 0 }
            : EMPTY_INPUT;
        stepWorld(w, input);
        if (w.phase === RUN_PHASE_DEAD) break;
      }

      // Something has to have happened, or the assertion below passes on 0 === 0.
      expect(w.stats.damageDealt, `${id} dealt nothing`).toBeGreaterThan(0);
      // Float64 accumulation in a different order, so exact equality is not the claim - but the
      // two are summed from the same increments, so anything beyond rounding is a missing site.
      expect(sumSources(w), `${id}`).toBeCloseTo(w.stats.damageDealt, 6);
    }
  });

  it('credits the Energy Shield separately from every gun', () => {
    // Plum opens with the shield and no weapon at all, so every point of damage in its run came
    // from the backlash and none of it can have been attributed to a gun.
    const w = createWorld({
      seed: 7,
      heroId: heroIndex('plum'),
      runLengthSec: 900,
      tuning: DEFAULT_TUNING,
    });
    for (let t = 0; t < 60 * 60; t++) {
      stepWorld(w, EMPTY_INPUT);
      if (w.phase === RUN_PHASE_DEAD) break;
    }

    expect(w.stats.damageByShield).toBeGreaterThan(0);
    expect(w.stats.damageByShield).toBeCloseTo(w.stats.damageDealt, 6);
    for (let i = 0; i < w.stats.damageByWeapon.length; i++) {
      expect(w.stats.damageByWeapon[i], `weapon ${i}`).toBe(0);
    }
  });
});
